from pathlib import Path
import sys,re
root=Path(sys.argv[1])
p=root/"OpenUtau.Core/Util/PathManager.cs"
s=p.read_text(encoding="utf-8-sig")
needle="if (OS.IsMacOS()) {"
replacement="""if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("JWOO_ENGINE_DATA"))) {
                DataPath = Path.GetFullPath(Environment.GetEnvironmentVariable("JWOO_ENGINE_DATA"));
                CachePath = Path.Combine(DataPath, "Cache");
                HomePathIsAscii = true;
            } else if (OS.IsMacOS()) {"""
assert s.count(needle)==1
p.write_text(s.replace(needle,replacement),encoding="utf-8")
# Preserve the exact resource-manager names in upstream generated classes.
for project in ("OpenUtau.Core","OpenUtau.Plugin.Builtin"):
    folder=root/project
    p=folder/(project+".csproj")
    s=p.read_text(encoding="utf-8-sig")
    items=[]
    for resx in folder.rglob("*.resx"):
        designer=resx.with_suffix(".Designer.cs")
        if not designer.is_file(): continue
        m=re.search(r'ResourceManager\("([^"]+)"',designer.read_text(encoding="utf-8-sig"))
        if m:
            name=m.group(1)+".resources"
            rel=resx.relative_to(folder).as_posix()
            items.append(f'<EmbeddedResource Update="{rel}" LogicalName="{name}" />')
    assert items
    s=s.replace("</Project>","<ItemGroup>"+"".join(items)+"</ItemGroup></Project>")
    p.write_text(s,encoding="utf-8")
