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
    names=set()
    for resx in folder.rglob("*.resx"):
        designer=resx.with_suffix(".Designer.cs")
        if not designer.is_file(): raise RuntimeError(f"Missing designer for {resx}")
        m=re.search(r'ResourceManager\("([^"]+)"',designer.read_text(encoding="utf-8-sig"))
        if not m: raise RuntimeError(f"ResourceManager name missing for {resx}")
        name=m.group(1)+".resources"
        rel=resx.relative_to(folder).as_posix()
        if name in names: raise RuntimeError(f"Duplicate resource {name}")
        names.add(name)
        items.append(f'<EmbeddedResource Include="{rel}" ManifestResourceName="{name[:-10]}" LogicalName="{name}" WithCulture="false" />')
    assert items
    s=s.replace("</Project>","<PropertyGroup><EnableDefaultEmbeddedResourceItems>false</EnableDefaultEmbeddedResourceItems><EmbeddedResourceUseDependentUponConvention>false</EmbeddedResourceUseDependentUponConvention></PropertyGroup><ItemGroup>"+"".join(items)+"</ItemGroup></Project>")
    print(project, "explicit resources:", sorted(names))
    p.write_text(s,encoding="utf-8")
