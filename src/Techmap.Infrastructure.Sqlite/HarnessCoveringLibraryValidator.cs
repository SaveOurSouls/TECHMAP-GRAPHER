using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;
internal static class HarnessCoveringLibraryValidator
{
    private static HarnessDesignDocumentException Invalid()=>new("invalid_drawing_documents","Invalid covering material library.","content.drawingDocuments.coveringLibrary");
    public static void Validate(JsonElement library)
    {
        if(library.ValueKind!=JsonValueKind.Object||!library.TryGetProperty("textures",out var textures)||textures.ValueKind!=JsonValueKind.Array||textures.GetArrayLength()>1000||!library.TryGetProperty("defaults",out var defaults)||defaults.ValueKind!=JsonValueKind.Object)throw Invalid();
        var hashes=new HashSet<string>(StringComparer.Ordinal);
        foreach(var row in textures.EnumerateArray())
        {
            if(row.ValueKind!=JsonValueKind.Object||!row.TryGetProperty("sha256",out var hash)||hash.ValueKind!=JsonValueKind.String||hash.GetString() is not {Length:64} s||s.Any(c=>c is not (>= '0' and <= '9' or >= 'a' and <= 'f'))||!hashes.Add(s)||!row.TryGetProperty("name",out var name)||name.ValueKind!=JsonValueKind.String||name.GetString() is not {Length:>0 and <=255} n||string.IsNullOrWhiteSpace(n))throw Invalid();
        }
        var kinds=new HashSet<string>(StringComparer.Ordinal);
        foreach(var row in defaults.EnumerateObject())
        {
            if(!kinds.Add(row.Name)||row.Name is not ("heat-shrink" or "nylon" or "braid" or "metal-braid" or "tape" or "band")||row.Value.ValueKind!=JsonValueKind.Object||!row.Value.TryGetProperty("texture",out var texture)||!HarnessCoveringStyleValidator.ValidTexture(texture))throw Invalid();
            var key=texture.GetString()!;if(key.StartsWith("asset:",StringComparison.Ordinal)&&!hashes.Contains(key[6..]))throw Invalid();
            if(row.Value.TryGetProperty("material",out var material))HarnessPhysicalTopologyValidator.ValidateMaterial(material);
        }
    }
}
