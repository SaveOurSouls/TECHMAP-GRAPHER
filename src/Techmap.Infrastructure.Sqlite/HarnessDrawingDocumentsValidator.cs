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
        static void Diameter(JsonElement owner,string key){
            if(owner.ValueKind==JsonValueKind.Object&&owner.TryGetProperty(key,out var value)&&
                (value.ValueKind!=JsonValueKind.Number||!value.TryGetDouble(out var number)||!double.IsFinite(number)||number<=0||number>1000))throw Invalid();
        }
        if(root.TryGetProperty("connectors",out var connectors)&&connectors.ValueKind==JsonValueKind.Array)
            foreach(var connector in connectors.EnumerateArray())if(connector.TryGetProperty("contacts",out var contacts)&&contacts.ValueKind==JsonValueKind.Array)
                foreach(var contact in contacts.EnumerateArray())Diameter(contact,"wireDiameterMm");
        if(root.TryGetProperty("wires",out var wires)&&wires.ValueKind==JsonValueKind.Array)
            foreach(var wire in wires.EnumerateArray())if(wire.TryGetProperty("materialBinding",out var material))Diameter(material,"outerDiameterMm");
        if(!root.TryGetProperty("drawingDocuments",out var d))return;
        if(d.ValueKind!=JsonValueKind.Object)throw Invalid();
        if(d.TryGetProperty("coveringLibrary",out var coveringLibrary))HarnessCoveringLibraryValidator.Validate(coveringLibrary);
        if(d.TryGetProperty("bendRadius",out var radius)&&(radius.ValueKind!=JsonValueKind.Number||!radius.TryGetDouble(out var radiusValue)||!double.IsFinite(radiusValue)||radiusValue<0||radiusValue>200))throw Invalid();
        if(d.TryGetProperty("leaderScale",out var leaderScale)&&(leaderScale.ValueKind!=JsonValueKind.Number||!leaderScale.TryGetDouble(out var leaderFactor)||!double.IsFinite(leaderFactor)||leaderFactor<.25||leaderFactor>4))throw Invalid();
        if(d.TryGetProperty("physicalScale",out var scale)&&(scale.ValueKind!=JsonValueKind.Number||!scale.TryGetDouble(out var factor)||!double.IsFinite(factor)||factor<.2||factor>8))throw Invalid();
        if(d.TryGetProperty("showDimensions",out var visible)&&visible.ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw Invalid();
        if(d.TryGetProperty("volumeShading",out var shading)&&shading.ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw Invalid();
        var ids=new HashSet<string>(StringComparer.Ordinal);
        foreach(var key in new[]{"connectors","wires","cables"}) if(root.TryGetProperty(key,out var list)&&list.ValueKind==JsonValueKind.Array) foreach(var e in list.EnumerateArray())ids.Add(Text(e,"id"));
        if(root.TryGetProperty("physicalTopology",out var t)&&t.ValueKind==JsonValueKind.Object) foreach(var key in new[]{"nodes","segments","coverings"})if(t.TryGetProperty(key,out var list)&&list.ValueKind==JsonValueKind.Array)foreach(var e in list.EnumerateArray())ids.Add(Text(e,"id"));
        foreach(var table in Array(d,"tables",20).EnumerateArray())
        {
            if(!ids.Add(Text(table,"id")) || Text(table,"kind") is not ("bom" or "connections" or "cut"))throw Invalid();
            Point(table,"position");
            if(table.TryGetProperty("dock",out var dock) && (dock.ValueKind!=JsonValueKind.String || dock.GetString() is not ("left" or "right" or "top" or "bottom")))throw Invalid();
            if(table.TryGetProperty("width",out var width) && (width.ValueKind!=JsonValueKind.Number||!width.TryGetDouble(out var widthValue)||!double.IsFinite(widthValue)||widthValue<280||widthValue>4000))throw Invalid();
            if(table.TryGetProperty("height",out var height) && (height.ValueKind!=JsonValueKind.Number||!height.TryGetDouble(out var heightValue)||!double.IsFinite(heightValue)||heightValue<160||heightValue>4000))throw Invalid();
        }
        foreach(var leader in Array(d,"leaders",10000).EnumerateArray())
        {
            var id=Text(leader,"id");if(!ids.Add(id)||!ids.Add(id+":anchor"))throw Invalid();
            _=Text(leader,"objectId");_=Text(leader,"rowKey",4096);Point(leader,"anchorOffset");Point(leader,"circle");
            if(leader.TryGetProperty("anchorLocal",out _))Point(leader,"anchorLocal");
            if(leader.TryGetProperty("hidden",out var hidden)&&hidden.ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw Invalid();
        }
        if(d.TryGetProperty("bomText",out var edits))
        {
            if(edits.ValueKind!=JsonValueKind.Object||edits.EnumerateObject().Count()>50000)throw Invalid();
            foreach(var entry in edits.EnumerateObject())
            {
                if(string.IsNullOrWhiteSpace(entry.Name)||entry.Name.Length>4096||entry.Value.ValueKind!=JsonValueKind.Object)throw Invalid();
                foreach(var field in entry.Value.EnumerateObject())if(field.Name is not ("index" or "designation" or "name" or "note")||field.Value.ValueKind!=JsonValueKind.String||field.Value.GetString()!.Length>4096)throw Invalid();
            }
        }
        if(d.TryGetProperty("specificationItems",out var items))
        {
            if(items.ValueKind!=JsonValueKind.Array||items.GetArrayLength()>50000)throw Invalid();
            var itemIds=new HashSet<string>(StringComparer.Ordinal);
            foreach(var item in items.EnumerateArray()){
                var id=Text(item,"id");if(!itemIds.Add(id)||!ids.Add(id)||Text(item,"kind") is not ("abstract" or "manual")||Text(item,"type",256).Length>256||!item.TryGetProperty("designation",out var designation)||designation.ValueKind!=JsonValueKind.String||designation.GetString()!.Length>4096||!Text(item,"name",4096).Any()||!item.TryGetProperty("amount",out var amount)||amount.ValueKind is not (JsonValueKind.Null or JsonValueKind.Number)||amount.ValueKind==JsonValueKind.Number&&(!amount.TryGetDecimal(out var number)||number<0||number>1000000000)||Text(item,"unit") is not ("шт." or "м" or "г" or "кг" or "л")||!item.TryGetProperty("note",out var note)||note.ValueKind!=JsonValueKind.String||note.GetString()!.Length>4096)throw Invalid();
                if(item.TryGetProperty("position",out _))Point(item,"position");
                if(item.TryGetProperty("objectId",out _))_=Text(item,"objectId");
                if(item.TryGetProperty("sourceIdentity",out _))_=Text(item,"sourceIdentity",4096);
            }
        }
        HarnessDrawingDimensionsValidator.Validate(root,d,ids);
        var keys=new HashSet<string>(StringComparer.Ordinal);
        foreach(var key in Array(d,"bomOrder",50000).EnumerateArray())if(key.ValueKind!=JsonValueKind.String || key.GetString() is not {} s || string.IsNullOrWhiteSpace(s)||s.Length>4096||!keys.Add(s))throw Invalid();
    }
}
