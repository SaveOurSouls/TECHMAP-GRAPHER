using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static class HarnessDrawingDocumentsValidator
{
    private static HarnessDesignDocumentException Invalid() => new("invalid_drawing_documents", "Invalid drawing tables or position leaders.", "content.drawingDocuments");
    private static string Text(JsonElement e,string key,int limit=128) => e.ValueKind==JsonValueKind.Object && e.TryGetProperty(key,out var v) && v.ValueKind==JsonValueKind.String && v.GetString() is {} s && !string.IsNullOrWhiteSpace(s) && s.Length<=limit ? s : throw Invalid();
    private static JsonElement Array(JsonElement e,string key,int limit) => e.ValueKind==JsonValueKind.Object && e.TryGetProperty(key,out var v) && v.ValueKind==JsonValueKind.Array && v.GetArrayLength()<=limit ? v : throw Invalid();
    private static void Point(JsonElement e,string key)
    {
        if(!e.TryGetProperty(key,out var p)||p.ValueKind!=JsonValueKind.Object)throw Invalid();
        foreach(var axis in new[]{"x","y"}) if(!p.TryGetProperty(axis,out var v)||v.ValueKind!=JsonValueKind.Number||!v.TryGetDouble(out var n)||!double.IsFinite(n)||Math.Abs(n)>1e7)throw Invalid();
    }
    public static void Validate(JsonElement root)
    {
        if(!root.TryGetProperty("drawingDocuments",out var d))return;
        var ids=new HashSet<string>(StringComparer.Ordinal);
        foreach(var key in new[]{"connectors","wires","cables"}) if(root.TryGetProperty(key,out var list)&&list.ValueKind==JsonValueKind.Array) foreach(var e in list.EnumerateArray())ids.Add(Text(e,"id"));
        if(root.TryGetProperty("physicalTopology",out var t)&&t.ValueKind==JsonValueKind.Object) foreach(var key in new[]{"nodes","segments","coverings"})if(t.TryGetProperty(key,out var list)&&list.ValueKind==JsonValueKind.Array)foreach(var e in list.EnumerateArray())ids.Add(Text(e,"id"));
        foreach(var table in Array(d,"tables",20).EnumerateArray())
        {
            if(!ids.Add(Text(table,"id")) || Text(table,"kind") is not ("bom" or "connections" or "cut"))throw Invalid();
            Point(table,"position");
            if(table.TryGetProperty("dock",out var dock) && (dock.ValueKind!=JsonValueKind.String || dock.GetString() is not ("left" or "right" or "top" or "bottom")))throw Invalid();
        }
        foreach(var leader in Array(d,"leaders",10000).EnumerateArray())
        {
            var id=Text(leader,"id");if(!ids.Add(id)||!ids.Add(id+":anchor"))throw Invalid();
            _=Text(leader,"objectId");_=Text(leader,"rowKey",4096);Point(leader,"anchorOffset");Point(leader,"circle");
        }
        if(d.TryGetProperty("bomText",out var edits))
        {
            if(edits.ValueKind!=JsonValueKind.Object||edits.EnumerateObject().Count()>50000)throw Invalid();
            foreach(var entry in edits.EnumerateObject())
            {
                if(string.IsNullOrWhiteSpace(entry.Name)||entry.Name.Length>4096||entry.Value.ValueKind!=JsonValueKind.Object)throw Invalid();
                foreach(var field in entry.Value.EnumerateObject())if(field.Name is not ("designation" or "name" or "note")||field.Value.ValueKind!=JsonValueKind.String||field.Value.GetString()!.Length>4096)throw Invalid();
            }
        }
        HarnessDrawingDimensionsValidator.Validate(root,d,ids);
        var keys=new HashSet<string>(StringComparer.Ordinal);
        foreach(var key in Array(d,"bomOrder",50000).EnumerateArray())if(key.ValueKind!=JsonValueKind.String || key.GetString() is not {} s || string.IsNullOrWhiteSpace(s)||s.Length>4096||!keys.Add(s))throw Invalid();
    }
}
