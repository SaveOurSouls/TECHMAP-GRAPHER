using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>
/// Validates schema v5, where terminal compatibility has one root authority
/// and the article/table contact groups only carry contact counts.
/// </summary>
internal static class ComponentTemplateContentV5Validator
{
    private static readonly string[] RootProperties =
    [
        "schemaVersion", "views", "logicalContacts", "parameters", "repeaters", "assets",
        "contactTypeGroups", "articleVariants", "compatibleTerminalArticleKeys", "e4ConnectorTable",
    ];

    internal static void Validate(JsonElement content)
    {
        RequireExactPropertiesWithOptional(content, "content", RootProperties, "terminalContactTypeBindings", "e4Presentation", "articleDrawings", "drawingContactBindings", "drawingGenerators");
        if (content.TryGetProperty("e4Presentation", out var presentation)) ValidatePresentation(presentation);
        if (content.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
            !content.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 5)
            Throw("Only component template schemaVersion 5 is supported.", "content.schemaVersion");

        var compatible = ValidateCompatibleTerminals(content.GetProperty("compatibleTerminalArticleKeys"));
        var terminalBindings = ValidateTerminalBindings(content, compatible);
        ValidateArticleGroupShapes(content.GetProperty("articleVariants"));
        ValidateTableV2Shape(content.GetProperty("e4ConnectorTable"), compatible);

        var projected = JsonNode.Parse(content.GetRawText())!.AsObject();
        projected["schemaVersion"] = 4;
        projected.Remove("compatibleTerminalArticleKeys");
        projected.Remove("terminalContactTypeBindings");
        projected.Remove("e4Presentation");
        projected.Remove("articleDrawings");
        projected.Remove("drawingContactBindings");
        projected.Remove("drawingGenerators");
        var terminalNodes = CompatibleTerminalNodes(content.GetProperty("compatibleTerminalArticleKeys"));
        foreach (var variant in projected["articleVariants"]!.AsArray())
        {
            if (variant!["contactGroups"] is not JsonArray groups) continue;
            foreach (var group in groups)
                group!["allowedTerminalArticleKeys"] = TerminalNodesForGroup(terminalNodes, terminalBindings, group!["contactTypeGroupId"]!.GetValue<string>());
        }
        var table = projected["e4ConnectorTable"]!.AsObject();
        table["modelVersion"] = 1;
        foreach (var article in table["articles"]!.AsArray())
            foreach (var group in article!["contactGroups"]!.AsArray())
                group!["allowedTerminalArticleKeys"] = TerminalNodesForGroup(terminalNodes, terminalBindings, group!["contactTypeGroupId"]!.GetValue<string>());

        using var projectedDocument = JsonDocument.Parse(projected.ToJsonString());
        ComponentTemplateContentV4Validator.Validate(projectedDocument.RootElement, independentE4: true);
        ValidateDrawingBindings(content);
        ValidateDrawingGenerators(content);
    }

    private static void ValidateDrawingGenerators(JsonElement content)
    {
        if (!content.TryGetProperty("drawingGenerators", out var generators)) return;
        const string path = "content.drawingGenerators";
        if (generators.ValueKind != JsonValueKind.Array || generators.GetArrayLength() > 32) Throw("At most 32 drawing generators are allowed.", path);
        var ids = new HashSet<string>(); var viewIds = new HashSet<string>(); var targets = new HashSet<string>();
        foreach (var g in generators.EnumerateArray())
        {
            RequireExactProperties(g, path, "id", "viewId", "target", "axis", "pitch", "rowPitch", "rows", "baseColumns", "traversal", "numbering", "reverse", "corner", "roles", "periodPointIds", "fixedPointIds", "endPointIds", "articles");
            var id = RequiredText(g.GetProperty("id"), 128, path);
            if (!Guid.TryParseExact(id, "D", out _) || !ids.Add(id)) Throw("Invalid or duplicate generator ID.", path);
            var viewId = RequiredText(g.GetProperty("viewId"), 128, path);
            var view = content.GetProperty("views").EnumerateArray().FirstOrDefault(v => v.GetProperty("id").GetString() == viewId);
            if (view.ValueKind != JsonValueKind.Object || view.GetProperty("kind").GetString() == "e4" || !viewIds.Add(viewId)) Throw("A generator requires a distinct graphic view.", path);
            var target = RequiredText(g.GetProperty("target"), 16, path);
            if (target is not ("e4" or "drawing" or "route") || RequiredText(g.GetProperty("axis"),32,path) is not ("horizontal" or "vertical") || RequiredText(g.GetProperty("traversal"),32,path) is not ("along" or "across") || RequiredText(g.GetProperty("numbering"),32,path) is not ("new-row" or "snake") || g.GetProperty("reverse").ValueKind is not (JsonValueKind.True or JsonValueKind.False)) Throw("Invalid generator settings.", path);
            if (RequiredText(g.GetProperty("corner"), 32, path) is not ("top-left" or "top-right" or "bottom-left" or "bottom-right")) Throw("Unknown numbering corner.", path);
            foreach (var key in new[] { "pitch", "rowPitch" }) if (g.GetProperty(key).ValueKind != JsonValueKind.Number || !g.GetProperty(key).TryGetDouble(out var pitch) || !double.IsFinite(pitch) || pitch <= 0 || pitch > 10000) Throw("Generator pitch must be positive and at most 10000.", path);
            var rows = 0; var columns = 0;
            if (g.GetProperty("rows").ValueKind != JsonValueKind.Number || !g.GetProperty("rows").TryGetInt32(out rows) || rows < 1 || rows > 4 || g.GetProperty("baseColumns").ValueKind != JsonValueKind.Number || !g.GetProperty("baseColumns").TryGetInt32(out columns) || columns < 1 || columns > 1000) Throw("Invalid generator row/base column count.", path);
            if (view.GetProperty("repeatPlacements").GetArrayLength() > 0) Throw("A generator source cannot contain legacy arrays.", path);
            var nodes = view.GetProperty("layers").EnumerateArray().SelectMany(l => l.GetProperty("nodes").EnumerateArray()).ToDictionary(n => n.GetProperty("id").GetString()!);
            var nodeIds = nodes.Keys.ToHashSet();
            var points = view.GetProperty("contactPoints").EnumerateArray().Select(p => p.GetProperty("id").GetString()!).ToHashSet();
            var owned = nodes.Values.Where(n => n.GetProperty("kind").GetString() == "group").SelectMany(n => n.GetProperty("geometry").GetProperty("childIds").EnumerateArray()).Select(n => n.GetString()!).ToHashSet();
            var claimed = new HashSet<string>();
            var roles = g.GetProperty("roles"); RequireExactProperties(roles, path, "start", "period", "end", "static");
            foreach (var role in roles.EnumerateObject())
            {
                ValidateDrawingIds(role.Value, nodeIds, path);
                foreach (var item in role.Value.EnumerateArray()) if (owned.Contains(item.GetString()!) || !claimed.Add(item.GetString()!)) Throw("A root figure must have one role.", path);
            }
            ValidateDrawingIds(g.GetProperty("periodPointIds"), points, path); ValidateDrawingIds(g.GetProperty("fixedPointIds"), points, path);
            var periodic = g.GetProperty("periodPointIds").EnumerateArray().Select(p => p.GetString()!).ToHashSet();
            var fixedPoints = g.GetProperty("fixedPointIds").EnumerateArray().Select(p => p.GetString()!).ToHashSet();
            ValidateDrawingIds(g.GetProperty("endPointIds"), fixedPoints, path);
            if (periodic.Overlaps(fixedPoints)) Throw("A contact cannot belong to two roles.", path);
            HashSet<string> Descendants(IEnumerable<string> roots)
            {
                var result = new HashSet<string>();
                void Visit(string nodeId) { if (!result.Add(nodeId)) return; var node = nodes[nodeId]; if (node.GetProperty("kind").GetString() == "group") foreach (var child in node.GetProperty("geometry").GetProperty("childIds").EnumerateArray()) Visit(child.GetString()!); }
                foreach (var root in roots) Visit(root); return result;
            }
            var baseIds = Descendants(claimed); var extras = new HashSet<string>(); var seenArticles = new HashSet<string>();
            var articles = g.GetProperty("articles"); if (articles.ValueKind != JsonValueKind.Array) Throw("Generator articles must be an array.", path);
            foreach (var article in articles.EnumerateArray())
            {
                RequireExactProperties(article, path, "articleId", "nodeIds");
                var articleId = RequiredText(article.GetProperty("articleId"), 128, path);
                var table = content.GetProperty("e4ConnectorTable").GetProperty("articles").EnumerateArray().FirstOrDefault(a => a.GetProperty("articleVariantId").GetString() == articleId);
                if (table.ValueKind != JsonValueKind.Object || !seenArticles.Add(articleId) || !targets.Add(target + ":" + articleId)) Throw("Unknown or duplicate generator article.", path);
                ValidateDrawingIds(article.GetProperty("nodeIds"), nodeIds, path);
                foreach (var extra in article.GetProperty("nodeIds").EnumerateArray()) if (!claimed.Add(extra.GetString()!)) Throw("An article addition cannot be shared.", path);
                var local = Descendants(article.GetProperty("nodeIds").EnumerateArray().Select(n => n.GetString()!));
                if (local.Overlaps(baseIds) || local.Overlaps(extras)) Throw("An article addition cannot own shared geometry.", path); extras.UnionWith(local);
                var total = table.GetProperty("rows").GetArrayLength() - fixedPoints.Count;
                if (periodic.Count == 0 || roles.GetProperty("period").GetArrayLength() == 0 || total <= 0 || total % periodic.Count != 0 || total / periodic.Count > 1000 || total / periodic.Count % rows != 0) Throw("Article contacts must form complete generator periods and rows.", path);
                var periodNodes = Descendants(roles.GetProperty("period").EnumerateArray().Select(n => n.GetString()!));
                if (periodNodes.Count * (total / periodic.Count) + nodes.Count > 5000) Throw("Generated article exceeds 5000 figures.", path);
                var bound = new HashSet<string>();
                foreach (var fixedId in fixedPoints)
                {
                    var logical = view.GetProperty("contactPoints").EnumerateArray().First(p => p.GetProperty("id").GetString() == fixedId).GetProperty("logicalContactId").GetString();
                    var binding = content.TryGetProperty("drawingContactBindings", out var bindings) ? bindings.EnumerateArray().FirstOrDefault(b => b.GetProperty("logicalContactId").GetString() == logical) : default;
                    var rowId = binding.ValueKind == JsonValueKind.Object ? binding.GetProperty("seriesRowId").GetString() : null;
                    if (rowId is null || !table.GetProperty("rows").EnumerateArray().Any(r => r.GetProperty("seriesRowId").GetString() == rowId) || !bound.Add(rowId)) Throw("Fixed generator contacts must bind unique article rows.", path);
                }
            }
        }
    }

    private static void ValidateDrawingBindings(JsonElement content)
    {
        var articles = content.GetProperty("articleVariants").EnumerateArray().Select(a => a.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
        var contacts = content.GetProperty("logicalContacts").EnumerateArray().Select(a => a.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
        var rows = content.GetProperty("e4ConnectorTable").GetProperty("seriesDefaults").EnumerateArray().Select(a => a.GetProperty("rowId").GetString()!).ToHashSet(StringComparer.Ordinal);
        var nodes = new HashSet<string>(StringComparer.Ordinal);
        var points = new HashSet<string>(StringComparer.Ordinal);
        foreach (var view in content.GetProperty("views").EnumerateArray())
        {

            foreach (var layer in view.GetProperty("layers").EnumerateArray())
                foreach (var node in layer.GetProperty("nodes").EnumerateArray()) nodes.Add(node.GetProperty("id").GetString()!);
            foreach (var point in view.GetProperty("contactPoints").EnumerateArray()) points.Add(point.GetProperty("id").GetString()!);
        }
        if (content.TryGetProperty("articleDrawings", out var drawings))
        {
            if (drawings.ValueKind != JsonValueKind.Array) Throw("An array is required.", "content.articleDrawings");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var drawing in drawings.EnumerateArray())
            {
                const string path = "content.articleDrawings";
                RequireExactPropertiesWithOptional(drawing, path, ["articleVariantId", "nodeIds", "contactPointIds"], "target", "viewId", "bundlePortIds");
                var target = drawing.TryGetProperty("target", out var targetValue) ? RequiredText(targetValue, 16, path + ".target") : null;
                if (target is not null && target is not ("e4" or "drawing" or "route")) Throw("Unknown drawing target.", path);
                if (target is null && drawing.TryGetProperty("viewId", out _)) Throw("Drawing target required.", path);
                if (target is not null)
                {
                    if (!drawing.TryGetProperty("viewId", out var viewId)) Throw("Drawing view required.", path);
                    var idOfView = RequiredText(viewId, 128, path + ".viewId");
                    var view = content.GetProperty("views").EnumerateArray().FirstOrDefault(v => v.GetProperty("id").GetString() == idOfView);
                    if (view.ValueKind != JsonValueKind.Object) Throw("Unknown drawing view.", path);
                    var ownNodes=view.GetProperty("layers").EnumerateArray().SelectMany(l=>l.GetProperty("nodes").EnumerateArray()).Select(n=>n.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
                    var ownPoints=view.GetProperty("contactPoints").EnumerateArray().Select(p=>p.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
                    ValidateDrawingIds(drawing.GetProperty("nodeIds"),ownNodes,path);
                    ValidateDrawingIds(drawing.GetProperty("contactPointIds"),ownPoints,path);
                    var ports=drawing.TryGetProperty("bundlePortIds",out var bundle)?bundle:default;
                    if(ports.ValueKind!=JsonValueKind.Undefined)
                    {
                        var ownPorts=view.GetProperty("bundlePorts").EnumerateArray().Select(p=>p.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
                        ValidateDrawingIds(ports,ownPorts,path);
                        if(ports.GetArrayLength()>1 || ports.GetArrayLength()>0&&(target!="drawing"||drawing.GetProperty("contactPointIds").GetArrayLength()>0))Throw("A single bundle contact is allowed only for Drawing without individual contacts.",path);
                    }
                    if(ports.ValueKind!=JsonValueKind.Array||ports.GetArrayLength()==0)ValidateDrawingContactCount(content,drawing,view,path);
                }
                var id = RequiredText(drawing.GetProperty("articleVariantId"), 128, path);
                if (!articles.Contains(id) || !seen.Add(id + ":" + (target ?? "legacy"))) Throw("Unknown or duplicate drawing article.", path);
                ValidateDrawingIds(drawing.GetProperty("nodeIds"), nodes, path + ".nodeIds");
                ValidateDrawingIds(drawing.GetProperty("contactPointIds"), points, path + ".contactPointIds");
            }
        }
        if (content.TryGetProperty("drawingContactBindings", out var bindings))
        {
            const string path = "content.drawingContactBindings";
            if (bindings.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
            var seenContacts = new HashSet<string>(StringComparer.Ordinal);
            var seenRows = new HashSet<string>(StringComparer.Ordinal);
            foreach (var binding in bindings.EnumerateArray())
            {
                RequireExactProperties(binding, path, "logicalContactId", "seriesRowId");
                var contact = RequiredText(binding.GetProperty("logicalContactId"), 128, path);
                var row = RequiredText(binding.GetProperty("seriesRowId"), 512, path);
                if (!contacts.Contains(contact) || !rows.Contains(row) || !seenContacts.Add(contact) || !seenRows.Add(row))
                    Throw("Unknown or duplicate drawing contact binding.", path);
            }
        }
    }

    private static void ValidateDrawingContactCount(JsonElement content,JsonElement drawing,JsonElement view,string path)
    {
        var selected=drawing.GetProperty("contactPointIds").EnumerateArray().Select(p=>p.GetString()!).ToHashSet(StringComparer.Ordinal);
        // An illustration without electrical anchors is valid, including a
        // replacement image drawn after clearing an article.
        var nodes=drawing.GetProperty("nodeIds").EnumerateArray().Select(node=>node.GetString()!).ToHashSet(StringComparer.Ordinal);
        var contactShape=view.GetProperty("contactPoints").EnumerateArray().Any(point=>point.TryGetProperty("shape",out var shape)&&nodes.Contains(shape.GetProperty("nodeId").GetString()!));
        var contactArray=view.GetProperty("repeatPlacements").EnumerateArray().Any(repeat=>repeat.GetProperty("contactPointIds").GetArrayLength()>0&&nodes.Contains(repeat.GetProperty("prototypeGroupId").GetString()!));
        if(selected.Count==0&&!contactShape&&!contactArray)return;
        var article=content.GetProperty("articleVariants").EnumerateArray().FirstOrDefault(a=>a.GetProperty("id").GetString()==drawing.GetProperty("articleVariantId").GetString());
        if(article.ValueKind!=JsonValueKind.Object)Throw("Unknown drawing article.",path);
        var expected=article.GetProperty("contactGroups").EnumerateArray().Sum(g=>g.GetProperty("contactCount").GetInt32());
        var represented=selected.Count;
        foreach(var repeat in view.GetProperty("repeatPlacements").EnumerateArray())
        {
            var prototype=repeat.GetProperty("contactPointIds").EnumerateArray().Select(p=>p.GetString()!).ToArray();
            var used=prototype.Count(selected.Contains);if(used==0)continue;
            if(used!=prototype.Length)Throw("Select all contacts of the drawing array.",path);
            var domain=content.GetProperty("repeaters").EnumerateArray().First(d=>d.GetProperty("id").GetString()==repeat.GetProperty("repeatDomainId").GetString());
            var parameterId=domain.GetProperty("countParameterId").GetString();
            var countValue=article.GetProperty("parameterValues").EnumerateArray().FirstOrDefault(p=>p.GetProperty("parameterId").GetString()==parameterId);
            var parameter=content.GetProperty("parameters").EnumerateArray().First(p=>p.GetProperty("id").GetString()==parameterId);
            var count=countValue.ValueKind==JsonValueKind.Object?countValue.GetProperty("value").GetInt32():parameter.GetProperty("defaultValue").GetInt32();
            var articleCount=repeat.TryGetProperty("arrayLayout",out var layout)&&layout.TryGetProperty("countSource",out var source)&&source.GetString()=="article";
            represented+=articleCount?expected-used:(count-1)*used;
        }
        if(represented!=expected)Throw($"Drawing must contain {expected} article contacts; found {represented}.",path);
    }

    private static void ValidateDrawingIds(JsonElement values, HashSet<string> allowed, string path)
    {
        if (values.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var value in values.EnumerateArray())
        {
            var id = RequiredText(value, 128, path);
            if (!allowed.Contains(id) || !seen.Add(id)) Throw("Unknown or duplicate drawing object.", path);
        }
    }

    private static void ValidatePresentation(JsonElement value)
    {
        const string path = "content.e4Presentation";
        RequireExactProperties(value, path, "orientation", "baseColumns", "customFields");
        if (RequiredText(value.GetProperty("orientation"), 32, path + ".orientation") is not ("contacts-left" or "contacts-right"))
            Throw("Invalid orientation.", path + ".orientation");
        var columns = value.GetProperty("baseColumns");
        if (columns.ValueKind != JsonValueKind.Array) Throw("An array is required.", path + ".baseColumns");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var column in columns.EnumerateArray())
        {
            RequireExactProperties(column, path + ".baseColumns", "key", "visible");
            var key = RequiredText(column.GetProperty("key"), 32, path + ".baseColumns.key");
            if (key is not ("number" or "contactType" or "circuit" or "terminal" or "wire" or "wireSection" or "color") || !keys.Add(key) ||
                column.GetProperty("visible").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                Throw("Invalid or duplicate base column.", path + ".baseColumns");
        }
        var fields = value.GetProperty("customFields");
        if (fields.ValueKind != JsonValueKind.Array) Throw("An array is required.", path + ".customFields");
        keys.Clear();
        foreach (var field in fields.EnumerateArray())
        {
            RequireExactProperties(field, path + ".customFields", "id", "label", "visible");
            var id = RequiredText(field.GetProperty("id"), 128, path + ".customFields.id");
            _ = RequiredText(field.GetProperty("label"), 120, path + ".customFields.label");
            if (!keys.Add(id) || field.GetProperty("visible").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                Throw("Invalid or duplicate custom field.", path + ".customFields");
        }
    }

    private static Dictionary<string, (string ContactTypeGroupId, bool Standard)>? ValidateTerminalBindings(
        JsonElement content,
        IReadOnlySet<string> compatible)
    {
        if (!content.TryGetProperty("terminalContactTypeBindings", out var values)) return null;
        const string path = "content.terminalContactTypeBindings";
        if (values.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        var contactTypes = content.GetProperty("contactTypeGroups").EnumerateArray()
            .Select(group => group.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
        var result = new Dictionary<string, (string, bool)>(StringComparer.Ordinal);
        var standards = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var value in values.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            RequireExactProperties(value, itemPath, "terminalArticleKey", "contactTypeGroupId", "standard");
            var terminalIdentity = ValidateArticleKey(value.GetProperty("terminalArticleKey"), itemPath + ".terminalArticleKey");
            if (!compatible.Contains(terminalIdentity)) Throw("The bound terminal is absent from compatibleTerminalArticleKeys.", itemPath + ".terminalArticleKey");
            var groupId = RequiredText(value.GetProperty("contactTypeGroupId"), 128, itemPath + ".contactTypeGroupId");
            if (!contactTypes.Contains(groupId)) Throw("The bound contact type is absent from contactTypeGroups.", itemPath + ".contactTypeGroupId");
            var standardValue = value.GetProperty("standard");
            if (standardValue.ValueKind is not JsonValueKind.True and not JsonValueKind.False)
                Throw("A boolean is required.", itemPath + ".standard");
            var standard = standardValue.GetBoolean();
            if (!result.TryAdd(terminalIdentity, (groupId, standard))) Throw("A terminal can be bound only once.", itemPath);
            if (standard && !standards.Add(groupId)) Throw("Only one standard terminal is allowed per contact type.", itemPath);
        }
        return result;
    }

    private static JsonArray TerminalNodesForGroup(
        JsonArray terminals,
        IReadOnlyDictionary<string, (string ContactTypeGroupId, bool Standard)>? bindings,
        string groupId)
    {
        if (bindings is null) return (JsonArray)terminals.DeepClone();
        var result = new JsonArray();
        foreach (var terminal in terminals)
        {
            using var document = JsonDocument.Parse(terminal!.ToJsonString());
            var identity = ValidateArticleKey(document.RootElement, "content.compatibleTerminalArticleKeys");
            if (bindings.TryGetValue(identity, out var binding) && binding.ContactTypeGroupId == groupId)
                result.Add(terminal.DeepClone());
        }
        return result;
    }

    private static HashSet<string> ValidateCompatibleTerminals(JsonElement values)
    {
        const string path = "content.compatibleTerminalArticleKeys";
        if (values.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        if (values.GetArrayLength() > ComponentTemplateContentV3Validator.MaximumTerminalArticlesPerGroup)
            Throw($"A template cannot contain more than {ComponentTemplateContentV3Validator.MaximumTerminalArticlesPerGroup} compatible terminal articles.", path);
        var result = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var value in values.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            var identity = ValidateArticleKey(value, itemPath);
            if (!result.Add(identity)) Throw("A compatible terminal article cannot be repeated.", itemPath);
        }
        return result;
    }

    private static void ValidateArticleGroupShapes(JsonElement variants)
    {
        var variantIndex = 0;
        foreach (var variant in variants.EnumerateArray())
        {
            var groups = variant.GetProperty("contactGroups");
            if (groups.ValueKind != JsonValueKind.Array)
                Throw("Article contactGroups must be an array in schemaVersion 5.", $"content.articleVariants[{variantIndex}].contactGroups");
            var groupIndex = 0;
            foreach (var group in groups.EnumerateArray())
                RequireExactProperties(group, $"content.articleVariants[{variantIndex}].contactGroups[{groupIndex++}]", "contactTypeGroupId", "contactCount");
            variantIndex++;
        }
    }

    private static void ValidateTableV2Shape(JsonElement table, IReadOnlySet<string> compatible)
    {
        const string path = "content.e4ConnectorTable";
        if (table.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var modelVersion = table.GetProperty("modelVersion");
        if (modelVersion.ValueKind != JsonValueKind.Number || !modelVersion.TryGetInt32(out var parsed) || parsed != 2)
            Throw("Only E4 connector table modelVersion 2 is supported.", path + ".modelVersion");
        var articles = table.GetProperty("articles");
        if (articles.ValueKind != JsonValueKind.Array) Throw("An array is required.", path + ".articles");
        var articleIndex = 0;
        foreach (var article in articles.EnumerateArray())
        {
            var articlePath = $"{path}.articles[{articleIndex++}]";
            var groups = article.GetProperty("contactGroups");
            if (groups.ValueKind != JsonValueKind.Array) Throw("An array is required.", articlePath + ".contactGroups");
            var groupIndex = 0;
            foreach (var group in groups.EnumerateArray())
                RequireExactProperties(group, $"{articlePath}.contactGroups[{groupIndex++}]", "contactTypeGroupId", "contactCount");
            ValidateRowTerminals(article.GetProperty("rows"), articlePath + ".rows", compatible);
        }
        ValidateDefaultTerminals(table.GetProperty("seriesDefaults"), path + ".seriesDefaults", compatible);
    }

    private static void ValidateDefaultTerminals(JsonElement rows, string path, IReadOnlySet<string> compatible)
    {
        if (rows.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        var index = 0;
        foreach (var row in rows.EnumerateArray())
            ValidateTerminalValue(row.GetProperty("values"), $"{path}[{index++}].values", compatible);
    }

    private static void ValidateRowTerminals(JsonElement rows, string path, IReadOnlySet<string> compatible)
    {
        if (rows.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        var index = 0;
        foreach (var row in rows.EnumerateArray())
            ValidateTerminalValue(row.GetProperty("overrides"), $"{path}[{index++}].overrides", compatible);
    }

    private static void ValidateTerminalValue(JsonElement values, string path, IReadOnlySet<string> compatible)
    {
        if (values.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        if (!values.TryGetProperty("standardTerminalArticleKey", out var value) || value.ValueKind == JsonValueKind.Null) return;
        var terminalPath = path + ".standardTerminalArticleKey";
        if (!compatible.Contains(ValidateArticleKey(value, terminalPath)))
            Throw("The standard terminal is absent from compatibleTerminalArticleKeys.", terminalPath);
    }

    private static JsonArray CompatibleTerminalNodes(JsonElement values)
    {
        var result = new JsonArray();
        foreach (var item in values.EnumerateArray()) result.Add(JsonNode.Parse(item.GetRawText()));
        return result;
    }

    private static string ValidateArticleKey(JsonElement value, string path)
    {
        RequireExactProperties(value, path, "sourceId", "entityType", "articleKey");
        return RequiredText(value.GetProperty("sourceId"), 128, path + ".sourceId") + "\0" +
            RequiredText(value.GetProperty("entityType"), 64, path + ".entityType") + "\0" +
            RequiredText(value.GetProperty("articleKey"), 512, path + ".articleKey");
    }

    private static string RequiredText(JsonElement value, int maximum, string path)
    {
        if (value.ValueKind != JsonValueKind.String) Throw("A string is required.", path);
        var text = value.GetString()!;
        if (string.IsNullOrWhiteSpace(text) || text.Length > maximum || text.Any(char.IsControl))
            Throw($"A non-empty string of at most {maximum} characters is required.", path);
        return text;
    }

    private static void RequireExactProperties(JsonElement value, string path, params string[] expected)
    {
        if (value.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var actual = value.EnumerateObject().Select(property => property.Name).ToArray();
        if (actual.Length != expected.Length || actual.Distinct(StringComparer.Ordinal).Count() != actual.Length ||
            !actual.Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal)))
            Throw("Object has missing, extra, or duplicate properties.", path);
    }

    private static void RequireExactPropertiesWithOptional(JsonElement value, string path, string[] required, params string[] optional)
    {
        if (value.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var actual = value.EnumerateObject().Select(property => property.Name).ToArray();
        var allowed = required.Concat(optional).ToHashSet(StringComparer.Ordinal);
        if (actual.Distinct(StringComparer.Ordinal).Count() != actual.Length || actual.Any(property => !allowed.Contains(property)) ||
            required.Any(property => !actual.Contains(property, StringComparer.Ordinal)))
            Throw("Object has missing, extra, or duplicate properties.", path);
    }

    [DoesNotReturn]
    private static void Throw(string message, string path) =>
        throw new ComponentTemplateException("component_template_content_invalid", message, path);
}
