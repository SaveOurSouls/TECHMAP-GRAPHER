using System.Globalization;
using System.Text.Json;
using System.Text;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static class ManufacturingRouteValidator
{
    private const int MaximumRows = 1000;
    private const int MaximumOperationsPerRow = 100;
    private const int MaximumReferences = 10000;

    internal static void Validate(JsonElement root)
    {
        if (!root.TryGetProperty("manufacturingRoute", out var route)) return;
        if (route.ValueKind != JsonValueKind.Object) throw Invalid("manufacturingRoute must be an object.", "content.manufacturingRoute");
        RequireExact(route, "contractVersion", "status", "source", "rows");
        if (!Int(route, "contractVersion", "content.manufacturingRoute.contractVersion", 1, 1)) throw Invalid("Unsupported manufacturing route contract.", "content.manufacturingRoute.contractVersion");
        var status = Text(route, "status", "content.manufacturingRoute.status", 32);
        if (status is not ("draft" or "completed")) throw Invalid("Invalid manufacturing route status.", "content.manufacturingRoute.status");
        ValidateSource(route.GetProperty("source"), "content.manufacturingRoute.source");
        var rowsElement = Array(route, "rows", "content.manufacturingRoute.rows", MaximumRows);
        var rows = new Dictionary<string, (JsonElement Value, string Path)>(StringComparer.Ordinal);
        var operations = new HashSet<string>(StringComparer.Ordinal);
        var rowRefs = new Dictionary<string, HashSet<(string Kind, string Id)>>(StringComparer.Ordinal);
        var referenceCount = 0;
        var rowIndex = 0;
        foreach (var row in rowsElement.EnumerateArray())
        {
            var path = $"content.manufacturingRoute.rows[{rowIndex++}]";
            var rowKeys = new[] { "id", "kind", "title", "comment", "sourceObjects", "dependsOn", "operations", "presentation", "prepared" };
            if (row.ValueKind == JsonValueKind.Object)
            {
                if (row.TryGetProperty("index", out _)) rowKeys = [..rowKeys, "index"];
                if (row.TryGetProperty("quantity", out _)) rowKeys = [..rowKeys, "quantity"];
                if (row.TryGetProperty("reserve", out _)) rowKeys = [..rowKeys, "reserve"];
                if (row.TryGetProperty("operationTimeMinutes", out _)) rowKeys = [..rowKeys, "operationTimeMinutes"];
                if (row.TryGetProperty("photos", out _)) rowKeys = [..rowKeys, "photos"];
                if (row.TryGetProperty("terminalRequirements", out _)) rowKeys = [..rowKeys, "terminalRequirements"];
                if (row.TryGetProperty("assemblyInputs", out _)) rowKeys = [..rowKeys, "assemblyInputs"];
                if (row.TryGetProperty("wireBlankSelections", out _)) rowKeys = [..rowKeys, "wireBlankSelections"];
                if (row.TryGetProperty("components", out _)) rowKeys = [..rowKeys, "components"];
            }
            RequireExact(row, rowKeys);
            var id = Text(row, "id", path + ".id", 128);
            if (!rows.TryAdd(id, (row, path))) throw Invalid("Manufacturing route row IDs must be unique.", path + ".id");
            var kind = Text(row, "kind", path + ".kind", 32);
            if (kind is not ("semiFinished" or "assembly")) throw Invalid("Invalid manufacturing route row kind.", path + ".kind");
            if (row.TryGetProperty("index", out var index) && (index.ValueKind != JsonValueKind.String || index.GetString()!.Length > 128)) throw Invalid("Invalid route row index.", path + ".index");
            ValidateOptionalNonNegative(row, "quantity", path, positive: true);
            ValidateOptionalNonNegative(row, "reserve", path, positive: false);
            ValidateOptionalNonNegative(row, "operationTimeMinutes", path, positive: false);
            _ = Text(row, "title", path + ".title", 512);
            _ = TextAllowEmpty(row, "comment", path + ".comment", 4000);
            var refs = ValidateSourceObjects(row.GetProperty("sourceObjects"), path + ".sourceObjects", ref referenceCount);
            if (row.TryGetProperty("components", out var components)) ValidateComponents(components, path + ".components", kind, refs, ref referenceCount);
            rowRefs[id] = refs;
            if (row.TryGetProperty("terminalRequirements", out var terminalRequirements))
                ValidateTerminalRequirements(terminalRequirements, path + ".terminalRequirements", refs, ref referenceCount);
            if (row.TryGetProperty("wireBlankSelections", out var wireBlankSelections))
                ValidateWireBlankSelections(wireBlankSelections, path + ".wireBlankSelections", kind, refs, ref referenceCount);
            var dependencies = TextArray(row, "dependsOn", path + ".dependsOn", 1000).ToArray();
            if (row.TryGetProperty("assemblyInputs", out var assemblyInputs))
                ValidateAssemblyInputs(assemblyInputs, path + ".assemblyInputs", kind, refs, dependencies, ref referenceCount);
            foreach (var dependency in dependencies)
            {
                referenceCount++;
                if (dependency == id) throw Invalid("A manufacturing route row cannot depend on itself.", path + ".dependsOn");
            }
            ValidateOperations(row.GetProperty("operations"), path + ".operations", operations, ref referenceCount);
            ValidatePresentation(row.GetProperty("presentation"), path + ".presentation", refs, ref referenceCount);
            if (row.GetProperty("prepared").ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Invalid("prepared must be boolean.", path + ".prepared");
            if (row.TryGetProperty("photos", out _))
            {
                var hashes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var photo in Array(row, "photos", path + ".photos", 16).EnumerateArray())
                {
                    RequireExact(photo, "sha256", "name"); RequireSha(photo, "sha256", path + ".photos");
                    _ = Text(photo, "name", path + ".photos.name", 255);
                    if (!hashes.Add(photo.GetProperty("sha256").GetString()!)) throw Invalid("Photo hashes must be unique within a row.", path + ".photos");
                }
            }
        }
        if (referenceCount > MaximumReferences) throw Invalid("Manufacturing route reference limit exceeded.", "content.manufacturingRoute");
        ValidateDependencies(rows);
        var introduced = new HashSet<(string Kind, string Id)>();
        foreach (var references in rowRefs.Values)
            foreach (var reference in references)
                if (!introduced.Add(reference)) throw Invalid("A source object may be introduced only once in the route.", "content.manufacturingRoute.rows");
        foreach (var row in rows)
        {
            var inherited = new HashSet<(string Kind, string Id)>();
            var visited = new HashSet<string>();
            void Collect(string id) { if (!visited.Add(id)) return; inherited.UnionWith(rowRefs[id]); foreach (var dep in TextArray(rows[id].Value, "dependsOn", rows[id].Path, 1000)) Collect(dep); }
            Collect(row.Key);
            foreach (var item in row.Value.Value.GetProperty("presentation").GetProperty("objects").EnumerateArray())
            {
                var reference = item.GetProperty("ref");
                if (!inherited.Contains((reference.GetProperty("kind").GetString()!, reference.GetProperty("id").GetString()!)))
                    throw Invalid("Presentation reference must belong to this row or its ancestors.", row.Value.Path + ".presentation.objects");
            }
        }
        if (status == "completed") ValidateCompleted(root, rows, rowRefs);
    }

    internal static void ValidateReferences(JsonElement root)
    {
        if (!root.TryGetProperty("manufacturingRoute", out var route)) return;
        var available = new HashSet<(string, string)>();
        foreach (var (kind, property) in new[] { ("wire", "wires"), ("cable", "cables"), ("connector", "connectors") })
            if (root.TryGetProperty(property, out var objects) && objects.ValueKind == JsonValueKind.Array)
                foreach (var item in objects.EnumerateArray()) available.Add((kind, item.GetProperty("id").GetString()!));
        if (root.TryGetProperty("physicalTopology", out var topology) && topology.ValueKind == JsonValueKind.Object && topology.TryGetProperty("coverings", out var coverings))
            foreach (var item in coverings.EnumerateArray()) available.Add(("covering", item.GetProperty("id").GetString()!));
        foreach (var row in route.GetProperty("rows").EnumerateArray())
            foreach (var item in row.GetProperty("sourceObjects").EnumerateArray())
                if (!available.Contains((item.GetProperty("kind").GetString()!, item.GetProperty("id").GetString()!)))
                    throw Invalid("Route source object does not exist in the current construction.", "content.manufacturingRoute.rows.sourceObjects");
        if (route.GetProperty("status").GetString() == "completed")
        {
            var introduced = route.GetProperty("rows").EnumerateArray().SelectMany(row => row.GetProperty("sourceObjects").EnumerateArray())
                .Select(item => (item.GetProperty("kind").GetString()!, item.GetProperty("id").GetString()!)).ToHashSet();
            if (available.Any(item => item.Item1 is "wire" or "covering" && !introduced.Contains(item)))
                throw Invalid("Completed route must introduce every construction wire and covering.", "content.manufacturingRoute.rows");
        }
    }

    private static HashSet<(string Kind, string Id)> ValidateSourceObjects(JsonElement value, string path, ref int count)
    {
        var result = new HashSet<(string Kind, string Id)>();
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > MaximumReferences) throw Invalid("Invalid route source object list.", path);
        var index = 0;
        foreach (var item in value.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            RequireExact(item, "kind", "id");
            var kind = Text(item, "kind", itemPath + ".kind", 32);
            if (kind is not ("wire" or "cable" or "covering" or "connector")) throw Invalid("Invalid route source object kind.", itemPath + ".kind");
            var id = Text(item, "id", itemPath + ".id", 128);
            if (!result.Add((kind, id))) throw Invalid("A route row cannot consume the same source object twice.", itemPath);
            count++;
        }
        return result;
    }

    private static void ValidateComponents(JsonElement value, string path, string kind, HashSet<(string Kind, string Id)> refs, ref int count)
    {
        if (kind != "semiFinished" || value.ValueKind != JsonValueKind.Array) throw Invalid("Invalid route components.", path);
        var seen = new HashSet<(string Kind, string Id)>();
        foreach (var component in value.EnumerateArray())
        {
            var componentKeys = new List<string> { "ref", "title" }; if (component.TryGetProperty("index", out _)) componentKeys.Add("index"); if (component.TryGetProperty("quantity", out _)) componentKeys.Add("quantity"); if (component.TryGetProperty("reserve", out _)) componentKeys.Add("reserve"); if (component.TryGetProperty("operationTimeMinutes", out _)) componentKeys.Add("operationTimeMinutes"); RequireExact(component, componentKeys.ToArray());
            var reference = component.GetProperty("ref"); RequireExact(reference, "kind", "id"); var key = (Text(reference, "kind", path, 32), Text(reference, "id", path, 128));
            if (!refs.Contains(key) || !seen.Add(key)) throw Invalid("Route components must match source objects exactly.", path);
            _ = Text(component, "title", path, 512); if (component.TryGetProperty("index", out _)) _ = Text(component, "index", path, 128);
            ValidateOptionalNonNegative(component, "quantity", path, true); ValidateOptionalNonNegative(component, "reserve", path, false); ValidateOptionalNonNegative(component, "operationTimeMinutes", path, false); count++;
        }
        if (seen.Count != refs.Count) throw Invalid("Route components must match source objects exactly.", path);
    }

    private static void ValidateAssemblyInputs(JsonElement value, string path, string rowKind,
        HashSet<(string Kind, string Id)> sourceRefs, string[] dependencies, ref int count)
    {
        if (rowKind != "assembly" || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > MaximumReferences)
            throw Invalid("Only assembly rows may contain input lines.", path);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var inputSources = new HashSet<(string Kind, string Id)>();
        var inputRows = new HashSet<string>(StringComparer.Ordinal);
        foreach (var input in value.EnumerateArray())
        {
            var inputPath = $"{path}[{count}]";
            var kind = Text(input, "kind", inputPath + ".kind", 16);
            if (!ids.Add(Text(input, "id", inputPath + ".id", 128)))
                throw Invalid("Assembly input IDs must be unique.", inputPath + ".id");
            if (kind == "source")
            {
                RequireExact(input, "id", "kind", "ref");
                var reference = input.GetProperty("ref"); RequireExact(reference, "kind", "id");
                var sourceKind = Text(reference, "kind", inputPath + ".ref.kind", 32);
                if (sourceKind is not ("wire" or "cable" or "covering" or "connector"))
                    throw Invalid("Invalid assembly source kind.", inputPath + ".ref.kind");
                if (!inputSources.Add((sourceKind, Text(reference, "id", inputPath + ".ref.id", 128))))
                    throw Invalid("Assembly source input is duplicated.", inputPath + ".ref");
            }
            else if (kind == "row")
            {
                RequireExact(input, "id", "kind", "rowId");
                if (!inputRows.Add(Text(input, "rowId", inputPath + ".rowId", 128)))
                    throw Invalid("Assembly row input is duplicated.", inputPath + ".rowId");
            }
            else throw Invalid("Invalid assembly input kind.", inputPath + ".kind");
            count++;
        }
        if (!inputSources.SetEquals(sourceRefs) || !inputRows.SetEquals(dependencies))
            throw Invalid("Assembly input lines must match sources and dependencies.", path);
    }

    private static void ValidateTerminalRequirements(JsonElement value, string path, HashSet<(string Kind, string Id)> refs, ref int count)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > MaximumReferences)
            throw Invalid("Invalid terminal requirement list.", path);
        var seen = new HashSet<(string WireId, string End)>();
        foreach (var item in value.EnumerateArray())
        {
            RequireExact(item, "wireId", "end", "terminalArticle", "stripLengthMm", "binding");
            var wireId = Text(item, "wireId", path, 128);
            var end = Text(item, "end", path, 4);
            if (end is not ("from" or "to") || !refs.Contains(("wire", wireId)) || !seen.Add((wireId, end)))
                throw Invalid("Terminal requirement must refer to a unique end of a wire introduced in its row.", path);
            count++;
            var article = TextAllowEmpty(item, "terminalArticle", path, 512);
            var length = item.GetProperty("stripLengthMm");
            if (length.ValueKind != JsonValueKind.Null &&
                (length.ValueKind != JsonValueKind.Number || !length.TryGetDecimal(out var mm) || mm < 0 || mm > 1_000_000_000m || decimal.Round(mm, 3) != mm))
                throw Invalid("Terminal stripping length must be null or nonnegative millimetres with up to three decimal places.", path);
            var binding = item.GetProperty("binding");
            if (binding.ValueKind == JsonValueKind.Null)
            {
                if (length.ValueKind != JsonValueKind.Null) throw Invalid("Terminal stripping length requires a pinned terminal record.", path);
                continue;
            }
            RequireExact(binding, "sourceId", "entityType", "snapshotId", "snapshotSha256", "recordId", "sourceKey", "displayName");
            if (Text(binding, "entityType", path, 64) != "terminal" || Text(binding, "sourceKey", path, 512) != article)
                throw Invalid("Terminal binding must identify the installed terminal article.", path);
            if (!Guid.TryParseExact(Text(binding, "snapshotId", path, 36), "D", out var snapshotId) || snapshotId == Guid.Empty)
                throw Invalid("Terminal snapshotId must be a non-empty UUID.", path);
            RequireSha(binding, "snapshotSha256", path); RequireSha(binding, "recordId", path);
            _ = Text(binding, "sourceId", path, 512); _ = Text(binding, "displayName", path, 512);
        }
    }

    private static void ValidateWireBlankSelections(JsonElement value, string path, string kind,
        HashSet<(string Kind, string Id)> refs, ref int count)
    {
        if (kind != "semiFinished" || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > MaximumReferences)
            throw Invalid("Only semi-finished rows may pin wire illustrations.", path);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var selection in value.EnumerateArray())
        {
            RequireExact(selection, "wireId", "binding");
            var wireId = Text(selection, "wireId", path, 128);
            if (!seen.Add(wireId) || !refs.Contains(("wire", wireId)))
                throw Invalid("Wire illustration must refer to a unique wire introduced in this row.", path);
            var binding = selection.GetProperty("binding");
            RequireExact(binding, "sourceId", "entityType", "snapshotId", "snapshotSha256", "recordId", "sourceKey", "displayName", "visual");
            if (Text(binding, "sourceId", path, 512) != "technology-wire-blanks" || Text(binding, "entityType", path, 64) != "wire-blank")
                throw Invalid("Wire illustration must come from the wire blank catalog.", path);
            if (!Guid.TryParseExact(Text(binding, "snapshotId", path, 36), "D", out var snapshotId) || snapshotId == Guid.Empty)
                throw Invalid("Wire illustration snapshotId must be a non-empty UUID.", path);
            RequireSha(binding, "snapshotSha256", path); RequireSha(binding, "recordId", path);
            _ = Text(binding, "sourceKey", path, 512); _ = Text(binding, "displayName", path, 512);
            var visual = binding.GetProperty("visual"); RequireExact(visual, "start", "end", "color", "templateId", "photoDataUrl");
            var start = Text(visual, "start", path, 32); var end = Text(visual, "end", path, 32);
            var validEnds = new[] { "cut", "copper", "tin", "terminal", "sealed", "sealed-pin" };
            if (!validEnds.Contains(start, StringComparer.Ordinal) || !validEnds.Contains(end, StringComparer.Ordinal)) throw Invalid("Wire illustration visual has an invalid end.", path);
            var color = Text(visual, "color", path, 16); if (!System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$")) throw Invalid("Wire illustration visual has an invalid color.", path);
            _ = Text(visual, "templateId", path, 128); var photo = visual.GetProperty("photoDataUrl"); if (photo.ValueKind != JsonValueKind.Null && (photo.ValueKind != JsonValueKind.String || photo.GetString()!.Length > 1_400_000 || !System.Text.RegularExpressions.Regex.IsMatch(photo.GetString()!, "^data:image/png;base64,[a-zA-Z0-9+/]+={0,2}$"))) throw Invalid("Wire illustration visual photo is invalid.", path);
            count++;
        }
    }

    private static void ValidateOperations(JsonElement value, string path, HashSet<string> operationIds, ref int count)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > MaximumOperationsPerRow) throw Invalid("Invalid route operation list.", path);
        var index = 0;
        foreach (var operation in value.EnumerateArray())
        {
            var operationPath = $"{path}[{index++}]";
            RequireExact(operation, "id", "binding", "mode", "note");
            var id = Text(operation, "id", operationPath + ".id", 128);
            if (!operationIds.Add(id)) throw Invalid("Operation IDs must be unique across the route.", operationPath + ".id");
            var mode = Text(operation, "mode", operationPath + ".mode", 32);
            if (mode is not ("cut" or "cut-strip-from" or "cut-strip-to" or "cut-strip-both" or "cut-crimp" or "tin" or "strip-from" or "strip-to" or "strip-both" or "assembly")) throw Invalid("Invalid route operation mode.", operationPath + ".mode");
            _ = TextAllowEmpty(operation, "note", operationPath + ".note", 4000);
            var binding = operation.GetProperty("binding");
            if (binding.ValueKind != JsonValueKind.Null)
            {
                RequireExact(binding, "sourceId", "entityType", "snapshotId", "snapshotSha256", "recordId", "sourceKey", "displayName");
                if (Text(binding, "entityType", operationPath + ".binding.entityType", 64) != "operation") throw Invalid("Operation binding entityType must be operation.", operationPath + ".binding.entityType");
                if (!Guid.TryParseExact(Text(binding, "snapshotId", operationPath + ".binding.snapshotId", 36), "D", out var snapshotId) || snapshotId == Guid.Empty) throw Invalid("Operation snapshotId must be a non-empty UUID.", operationPath + ".binding.snapshotId");
                RequireSha(binding, "snapshotSha256", operationPath + ".binding.snapshotSha256"); RequireSha(binding, "recordId", operationPath + ".binding.recordId");
                _ = Text(binding, "sourceId", operationPath + ".binding.sourceId", 512); _ = Text(binding, "sourceKey", operationPath + ".binding.sourceKey", 512); _ = Text(binding, "displayName", operationPath + ".binding.displayName", 512);
            }
        }
    }

    private static void ValidatePresentation(JsonElement value, string path, HashSet<(string Kind, string Id)> refs, ref int count)
    {
        var keys = new List<string> { "backgroundOpacity", "objects" };
        if (value.TryGetProperty("drawingObjects", out _)) keys.Add("drawingObjects");
        if (value.TryGetProperty("drawingCopy", out _)) keys.Add("drawingCopy");
        RequireExact(value, keys.ToArray());
        var opacity = Number(value, "backgroundOpacity", path + ".backgroundOpacity");
        if (!double.IsFinite(opacity) || opacity < 0 || opacity > 1) throw Invalid("Route background opacity must be between 0 and 1.", path + ".backgroundOpacity");
        var objects = Array(value, "objects", path + ".objects", MaximumReferences);
        var seen = new HashSet<(string, string)>();
        foreach (var item in objects.EnumerateArray())
        {
            RequireExact(item, "ref", "points", "hidden"); var refValue = item.GetProperty("ref"); RequireExact(refValue, "kind", "id");
            var reference = (Text(refValue, "kind", path + ".objects.ref.kind", 32), Text(refValue, "id", path + ".objects.ref.id", 128));
            if (reference.Item1 is not ("wire" or "cable" or "covering" or "connector") || !seen.Add(reference)) throw Invalid("Invalid or duplicate presentation reference.", path + ".objects.ref");
            if (item.GetProperty("hidden").ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Invalid("Presentation hidden must be boolean.", path + ".objects.hidden");
            var points = Array(item, "points", path + ".objects.points", 2000);
            foreach (var point in points.EnumerateArray()) { RequireExact(point, "x", "y"); var x = Number(point, "x", path); var y = Number(point, "y", path); if (!double.IsFinite(x) || !double.IsFinite(y) || Math.Abs(x) > 1e7 || Math.Abs(y) > 1e7) throw Invalid("Route presentation point is out of range.", path + ".objects.points"); }
            count++;
        }
        if (value.TryGetProperty("drawingObjects", out _))
        {
            var drawingObjects = Array(value, "drawingObjects", path + ".drawingObjects", MaximumReferences);
            var drawingSeen = new HashSet<(string Kind, string Id)>();
            foreach (var item in drawingObjects.EnumerateArray())
            {
                RequireExact(item, "id", "kind", "layerId", "points", "hidden");
                var id = Text(item, "id", path + ".drawingObjects.id", 128);
                var kind = Text(item, "kind", path + ".drawingObjects.kind", 128);
                _ = Text(item, "layerId", path + ".drawingObjects.layerId", 256);
                if (!drawingSeen.Add((kind, id))) throw Invalid("Duplicate drawing object.", path + ".drawingObjects");
                if (item.GetProperty("hidden").ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw Invalid("Drawing object hidden must be boolean.", path + ".drawingObjects.hidden");
                foreach (var point in Array(item, "points", path + ".drawingObjects.points", 2000).EnumerateArray())
                {
                    RequireExact(point, "x", "y");
                    var x = Number(point, "x", path); var y = Number(point, "y", path);
                    if (!double.IsFinite(x) || !double.IsFinite(y) || Math.Abs(x) > 1e7 || Math.Abs(y) > 1e7)
                        throw Invalid("Drawing object point is out of range.", path + ".drawingObjects.points");
                }
                count++;
            }
        }
        if (value.TryGetProperty("drawingCopy", out var drawingCopy))
        {
            ValidateDrawingCopy(drawingCopy, path + ".drawingCopy");
        }
    }

    private static void ValidateDrawingCopy(JsonElement value, string path)
    {
        RequireExact(value, "document", "hiddenObjectIds");
        var design = value.GetProperty("document");
        if (design.ValueKind != JsonValueKind.Object ||
            Encoding.UTF8.GetByteCount(design.GetRawText()) > SqliteHarnessDesignDocumentStore.MaximumContentBytes ||
            !design.TryGetProperty("schemaVersion", out var version) ||
            version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var schemaVersion) || schemaVersion != 1)
            throw Invalid("Invalid or oversized drawing copy.", path + ".document");
        foreach (var collection in new[] { "connectors", "wires", "cables", "junctions", "diffPairs", "screens" })
            if (!design.TryGetProperty(collection, out var values) || values.ValueKind != JsonValueKind.Array)
                throw Invalid("Drawing copy is missing a design collection.", path + ".document." + collection);
        if (!design.TryGetProperty("views", out var views) || views.ValueKind != JsonValueKind.Object ||
            !views.TryGetProperty("drawing", out var drawing) || drawing.ValueKind != JsonValueKind.Object ||
            !views.TryGetProperty("e4", out var e4) || e4.ValueKind != JsonValueKind.Object)
            throw Invalid("Drawing copy has invalid views.", path + ".document.views");
        var nodes = 0;
        void Inspect(JsonElement element, int depth)
        {
            if (++nodes > 100_000 || depth > 128) throw Invalid("Drawing copy exceeds complexity limits.", path + ".document");
            if (element.ValueKind == JsonValueKind.Object)
                foreach (var property in element.EnumerateObject())
                {
                    if (property.Name == "manufacturingRoute") throw Invalid("Drawing copy cannot contain a route.", path + ".document");
                    Inspect(property.Value, depth + 1);
                }
            else if (element.ValueKind == JsonValueKind.Array)
            {
                if (element.GetArrayLength() > 10_000) throw Invalid("Drawing copy array is too large.", path + ".document");
                foreach (var item in element.EnumerateArray()) Inspect(item, depth + 1);
            }
        }
        Inspect(design, 0);
        SqliteHarnessDesignDocumentStore.ValidateEmbeddedDesign(design);
        var hidden = value.GetProperty("hiddenObjectIds");
        if (hidden.ValueKind != JsonValueKind.Array || hidden.GetArrayLength() > MaximumReferences)
            throw Invalid("Invalid drawing copy hidden objects.", path + ".hiddenObjectIds");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in hidden.EnumerateArray())
            if (!seen.Add(String(item, path + ".hiddenObjectIds", 128)))
                throw Invalid("Duplicate hidden drawing object.", path + ".hiddenObjectIds");
    }

    private static void ValidateCompleted(JsonElement root, Dictionary<string, (JsonElement Value, string Path)> rows, Dictionary<string, HashSet<(string Kind, string Id)>> refs)
    {
        if (rows.Count == 0 || rows.Values.Any(row => row.Value.GetProperty("operations").GetArrayLength() == 0 || !row.Value.GetProperty("prepared").GetBoolean())) throw Invalid("Completed route must contain prepared rows with operations.", "content.manufacturingRoute.rows");
        var assemblies = rows.Where(pair => pair.Value.Value.GetProperty("kind").GetString() == "assembly").Select(pair => pair.Key).ToHashSet(StringComparer.Ordinal);
        if (assemblies.Count == 0) throw Invalid("Completed route requires a final assembly row.", "content.manufacturingRoute.rows");
        bool IsFinal(string id) { var reachable = new HashSet<string>(); void Visit(string next) { if (!reachable.Add(next)) return; foreach (var dep in TextArray(rows[next].Value, "dependsOn", rows[next].Path, 1000)) Visit(dep); } Visit(id); return reachable.Count == rows.Count; }
        if (!assemblies.Any(IsFinal)) throw Invalid("One final assembly must reach every route row.", "content.manufacturingRoute.rows");
        foreach (var row in rows.Values) foreach (var operation in row.Value.GetProperty("operations").EnumerateArray()) if (operation.GetProperty("binding").ValueKind == JsonValueKind.Null) throw Invalid("Completed route operations require a binding.", row.Path + ".operations");
        ValidatePresentationConflicts(rows);
    }

    private static void ValidatePresentationConflicts(Dictionary<string, (JsonElement Value, string Path)> rows)
    {
        var ancestry = new Dictionary<string, HashSet<string>>();
        HashSet<string> Ancestors(string id)
        {
            if (ancestry.TryGetValue(id, out var known)) return known;
            var result = new HashSet<string>();
            foreach (var parent in TextArray(rows[id].Value, "dependsOn", rows[id].Path, 1000))
            { result.Add(parent); result.UnionWith(Ancestors(parent)); }
            return ancestry[id] = result;
        }
        var cache = new Dictionary<string, Dictionary<(string Kind, string Id), HashSet<(string Origin, string State)>>>();
        foreach (var id in rows.Keys)
            if (Resolve(id).Values.Any(values => values.Select(value => value.State).Distinct().Count() > 1))
                throw Invalid("Inherited presentation states conflict; explicitly resolve the object's presentation in the row.", rows[id].Path + ".presentation.objects");
        Dictionary<(string Kind, string Id), HashSet<(string Origin, string State)>> Resolve(string id)
        {
            if (cache.TryGetValue(id, out var cached)) return cached;
            var result = new Dictionary<(string Kind, string Id), HashSet<(string Origin, string State)>>();
            foreach (var parent in TextArray(rows[id].Value, "dependsOn", rows[id].Path, 1000))
                foreach (var (reference, values) in Resolve(parent))
                {
                    if (!result.TryGetValue(reference, out var collected)) result[reference] = collected = new();
                    collected.UnionWith(values);
                }
            foreach (var values in result.Values)
            {
                var origins = values.Select(value => value.Origin).ToArray();
                values.RemoveWhere(value => origins.Any(other => other != value.Origin && Ancestors(other).Contains(value.Origin)));
            }
            foreach (var item in rows[id].Value.GetProperty("presentation").GetProperty("objects").EnumerateArray())
            {
                var reference = item.GetProperty("ref");
                var signature = (item.GetProperty("hidden").GetBoolean() ? "hidden:" : "visible:") +
                    string.Join(";", item.GetProperty("points").EnumerateArray().Select(point =>
                        point.GetProperty("x").GetDouble().ToString("R", CultureInfo.InvariantCulture) + "," + point.GetProperty("y").GetDouble().ToString("R", CultureInfo.InvariantCulture)));
                result[(reference.GetProperty("kind").GetString()!, reference.GetProperty("id").GetString()!)] = new() { (id, signature) };
            }
            return cache[id] = result;
        }
    }
    private static void ValidateDependencies(Dictionary<string, (JsonElement Value, string Path)> rows)
    {
        var state = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var id in rows.Keys) Visit(id);
        void Visit(string id) { if (state.TryGetValue(id, out var current)) { if (current == 1) throw Invalid("Manufacturing route dependencies must be acyclic.", rows[id].Path + ".dependsOn"); if (current == 2) return; } state[id] = 1; foreach (var dependency in TextArray(rows[id].Value, "dependsOn", rows[id].Path, 1000)) { if (!rows.ContainsKey(dependency)) throw Invalid("Manufacturing route dependency does not exist.", rows[id].Path + ".dependsOn"); Visit(dependency); } state[id] = 2; }
    }

    private static void ValidateSource(JsonElement source, string path) { RequireExact(source, "fingerprintVersion", "sha256"); if (!Int(source, "fingerprintVersion", path + ".fingerprintVersion", 1, 1)) throw Invalid("Unsupported route fingerprint version.", path + ".fingerprintVersion"); RequireSha(source, "sha256", path); }
    private static void RequireSha(JsonElement owner, string property, string path) { var value = Text(owner, property, path + "." + property, 128); if (value.Length != 64 || value.Any(c => !Uri.IsHexDigit(c))) throw Invalid("Expected a SHA-256 hex string.", path + "." + property); }
    private static JsonElement Array(JsonElement owner, string property, string path, int max) { if (!owner.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > max) throw Invalid("Expected a bounded array.", path); return value; }
    private static IEnumerable<string> TextArray(JsonElement owner, string property, string path, int max) { var array = Array(owner, property, path, max); var seen = new HashSet<string>(); foreach (var item in array.EnumerateArray()) { var text = String(item, path, 128); if (!seen.Add(text)) throw Invalid("Duplicate dependency.", path); yield return text; } }
    private static bool Int(JsonElement owner, string property, string path, int min, int max) => owner.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) && number >= min && number <= max;
    private static double Number(JsonElement owner, string property, string path) => owner.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) ? number : throw Invalid("Expected a finite number.", path + "." + property);
    private static void ValidateOptionalNonNegative(JsonElement owner, string property, string path, bool positive)
    {
        if (!owner.TryGetProperty(property, out var value)) return;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number) || number < (positive ? 1 : 0) || number > 1_000_000_000 || Math.Abs(number * 1000 - Math.Round(number * 1000)) > 1e-6)
            throw Invalid($"{property} must be a {(positive ? "positive" : "nonnegative")} finite number.", path + "." + property);
    }
    private static string Text(JsonElement owner, string property, string path, int max) => owner.TryGetProperty(property, out var value) ? String(value, path + "." + property, max) : throw Invalid("Expected non-empty text.", path + "." + property);
    private static string TextAllowEmpty(JsonElement owner, string property, string path, int max) { if (!owner.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.String || value.GetString()!.Length > max) throw Invalid("Expected bounded text.", path); return value.GetString()!; }
    private static string String(JsonElement value, string path, int max = 1024) => value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 0 and <= 1024 } text && text.Length <= max && !string.IsNullOrWhiteSpace(text) ? text : throw Invalid("Expected non-empty text.", path);
    private static void RequireExact(JsonElement value, params string[] properties) { if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != properties.Length || value.EnumerateObject().Any(property => !properties.Contains(property.Name, StringComparer.Ordinal)) || properties.Any(property => !value.TryGetProperty(property, out _))) throw Invalid("Route object has an unexpected or missing property.", "content.manufacturingRoute"); }
    private static HarnessDesignDocumentException Invalid(string message, string field) => new("invalid_manufacturing_route", message, field);
}
