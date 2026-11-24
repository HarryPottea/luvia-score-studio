using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using OpenUtau.Core;
using OpenUtau.Classic;
using OpenUtau.Core.DiffSinger;
using OpenUtau.Core.Format;
using OpenUtau.Core.Ustx;
using OpenUtau.Core.Util;

// Standalone renderer using pinned official OpenUtau Core; no third-party HTTP API.
// Pump the main synchronization context while the native phonemizer/render workers run.
sealed class MainPump : SynchronizationContext {
    readonly BlockingCollection<(SendOrPostCallback, object?)> queue = new();
    public override void Post(SendOrPostCallback d, object? state) => queue.Add((d,state));
    public void Step() { if(queue.TryTake(out var item, 20)) item.Item1(item.Item2); }
}
static class Program {
    const string ChiakiHash = "20bdc0c4a70580be3697013be54ad895c2e115cc8dea0e924d441d2fa97a8424";
    static int Main(string[] args) {
        try {
            if (args.Length < 1) throw new Exception("Specify list, install-chiaki or render.");
            var home = Environment.GetEnvironmentVariable("JWOO_ENGINE_DATA");
            if(string.IsNullOrWhiteSpace(home) || !Path.IsPathFullyQualified(home)) throw new Exception("Isolated engine data directory required.");
            Directory.CreateDirectory(home);
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            var paths = PathManager.Inst;
            // Fail closed if the build did not apply our isolated data-path patch.
            if(Path.GetFullPath(paths.DataPath) != Path.GetFullPath(home)) throw new Exception("Unexpected OpenUtau data directory.");
            Directory.CreateDirectory(paths.SingersPath);
            Directory.CreateDirectory(paths.CachePath);
            if((args[0]=="install-chiaki" && args.Length==2)||(args[0]=="install-voice" && args.Length==3)) {
                var expected=args[0]=="install-chiaki"?ChiakiHash:args[2];
                if(expected.Length!=64||expected.Any(c=>!Uri.IsHexDigit(c)))throw new Exception("SHA256 required.");
                using(var s=File.OpenRead(args[1])) {
                    if(!Convert.ToHexString(SHA256.HashData(s)).Equals(expected,StringComparison.OrdinalIgnoreCase)) throw new Exception("Official archive checksum mismatch.");
                }
                // Never install into an existing voice directory. Archive bytes are pinned.
                if(args[0]=="install-chiaki" && Directory.EnumerateFileSystemEntries(paths.SingersPath).Any()) throw new Exception("Singer directory is not empty.");
                var target=Path.Combine(paths.SingersPath,"bank-"+expected.ToLowerInvariant());
                if(Directory.Exists(target)||File.Exists(target))throw new Exception("Voicebank already installed.");
                using(var zip=ZipFile.OpenRead(args[1])) {
                    long total=0; var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach(var entry in zip.Entries) {
                        var n=entry.FullName.Replace('\\','/').TrimEnd('/');
                        if(n.Length==0 || n.StartsWith('/') || n.Contains(':') || n.Split('/').Any(x=>x==".."||x=="."||x=="") || !names.Add(n) || ((entry.ExternalAttributes>>16)&0xF000)==0xA000) throw new Exception("Unsafe archive entry.");
                        if(n.Split('/').Any(x=>x.EndsWith(".")||x.EndsWith(" ")||System.Text.RegularExpressions.Regex.IsMatch(x,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase))||System.Text.RegularExpressions.Regex.IsMatch(n,@"\.(exe|dll|dylib|so|bat|cmd|ps1|sh|app|js|py|vbs|msi|pkg|dmg)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase))throw new Exception("Unsupported voicebank file.");
                        total=checked(total+entry.Length); if(total>4L*1024*1024*1024) throw new Exception("Voicebank exceeds extraction limit.");
                    }
                }
                try {
                    new VoicebankInstaller(target, (_,_)=>{}, Encoding.UTF8, Encoding.UTF8).Install(args[1],"diffsinger");
                } catch { if(Directory.Exists(target))Directory.Delete(target,true);throw; }
                return 0;
            }
            var pump=new MainPump(); SynchronizationContext.SetSynchronizationContext(pump);
            var doc=DocManager.Inst; doc.PostOnUIThread = a=>pump.Post(_=>a(),null);
            doc.Initialize(Thread.CurrentThread,TaskScheduler.FromCurrentSynchronizationContext());
            Preferences.Default.PreRender=false;
            // CPU is the compatibility baseline. No unsupported GPU promise.
            Preferences.Default.OnnxRunner="CPU";
            SingerManager.Inst.Initialize();
            if(args[0]=="list" && args.Length==1) {
                var singers = SingerManager.Inst.Singers.Values.OfType<DiffSingerSinger>().Select(s=>new {id=s.Id,name=s.Name,singerType="DiffSinger"}).ToArray();
                Console.WriteLine(JsonSerializer.Serialize(singers));return 0;
            }
            if(args[0]!="render" || args.Length!=3) throw new Exception("Invalid command.");
            var project=Ustx.Load(args[1]);
            if(project.tracks.Count!=1 || project.parts.Count!=1 || project.parts[0] is not UVoicePart part) throw new Exception("Only one vocal track is allowed.");
            var track=project.tracks[0];
            if(track.Singer is not DiffSingerSinger ds || !ds.Found || track.Phonemizer is not DiffSingerKoreanPhonemizer || track.RendererSettings.Renderer?.ToString()!="DIFFSINGER") throw new Exception("Real Korean DiffSinger renderer unavailable.");
            doc.ExecuteCmd(new LoadProjectNotification(project));
            project.ValidateFull();
            var watch=Stopwatch.StartNew();
            while(watch.Elapsed<TimeSpan.FromSeconds(120)) {
                pump.Step();
                if(part.PhonemesUpToDate && part.phonemes.Count>0 && part.renderPhrases.Count>0) break;
            }
            if(!part.PhonemesUpToDate || part.phonemes.Count==0 || part.renderPhrases.Count==0 || part.phonemes.Any(p=>p.Error) || part.notes.Any(n=>n.Error)) throw new Exception("Korean phoneme or phrase validation failed.");
            var render=PlaybackManager.Inst.RenderMixdown(project,args[2]);
            while(!render.IsCompleted && watch.Elapsed<TimeSpan.FromSeconds(540)) pump.Step();
            if(!render.IsCompleted) throw new TimeoutException("Render exceeded limit.");
            render.GetAwaiter().GetResult();
            if(!File.Exists(args[2]) || new FileInfo(args[2]).Length<44) throw new Exception("Render did not produce WAV.");
            return 0;
        } catch(Exception ex) { Console.Error.WriteLine(ex.GetType().Name+": "+ex.Message);return 1; }
    }
}
