using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.RegularExpressions;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static partial class ComponentTemplateContentV2Validator
{
    internal const int MaximumViews = 34;
    internal const int MaximumLayersPerView = 128;
    internal const int MaximumNodes = 5_000;
    internal const int MaximumLogicalContacts = 2_000;
    internal const int MaximumParameters = 128;
    internal const int MaximumRepeatDomains = 64;
    internal const int MaximumAssets = 64;
    internal const int MaximumArticlePresets = 500;
    internal const int MaximumExpressionDepth = 8;
    internal const int MaximumExpressionNodes = 64;
    internal const int MaximumAssetBytes = 10 * 1024 * 1024;
    internal const double MaximumCoordinateMagnitude = 1_000_000;

    private const long MaximumSafeInteger = 9_007_199_254_740_991;

    private static readonly string[] RootProperties =
        ["schemaVersion", "views", "logicalContacts", "parameters", "repeaters", "assets", "articleParameterPresets"];
    private static readonly string[] ViewProperties =
        ["id", "name", "kind", "layers", "contactPoints", "bundlePorts", "repeatPlacements"];
    private static readonly string[] NodeProperties =
        ["id", "kind", "layerId", "visible", "locked", "opacity", "transform", "stroke", "fill", "geometry"];

    internal static void Validate(JsonElement content)
    {
        _ = ValidateMaterialized(content, null);
    }

    internal static IReadOnlyDictionary<string, long> ValidateMaterialized(
        JsonElement content,
        IReadOnlyDictionary<string, JsonElement>? parameterOverrides)
    {
        RequireExactProperties(content, "content", RootProperties);
        if (content.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
            !content.GetProperty("schemaVersion").TryGetInt32(out var schemaVersion) || schemaVersion != 2)
        {
            Throw("Only component template schemaVersion 2 is supported.", "content.schemaVersion");
        }

        var views = RequiredArray(content, "views", "content.views");
        var logicalContacts = RequiredArray(content, "logicalContacts", "content.logicalContacts");
        var parameters = RequiredArray(content, "parameters", "content.parameters");
        var repeatDomains = RequiredArray(content, "repeaters", "content.repeaters");
        var assets = RequiredArray(content, "assets", "content.assets");
        var presets = RequiredArray(content, "articleParameterPresets", "content.articleParameterPresets");
        RequireMaximum(views, MaximumViews, "content.views");
        RequireMaximum(logicalContacts, MaximumLogicalContacts, "content.logicalContacts");
        RequireMaximum(parameters, MaximumParameters, "content.parameters");
        RequireMaximum(repeatDomains, MaximumRepeatDomains, "content.repeaters");
        RequireMaximum(assets, MaximumAssets, "content.assets");
        RequireMaximum(presets, MaximumArticlePresets, "content.articleParameterPresets");

        var state = new ValidationState();
        ValidateParameters(parameters, state);
        ValidateParameterCycles(state.Parameters);
        ValidateParameterOverrides(parameterOverrides, state);
        ValidateDefaultParameterValues(state);
        ValidateAssets(assets, state);
        ValidateLogicalContacts(logicalContacts, state);
        ValidateRepeatDomains(repeatDomains, state);
        ValidateViews(views, state);
        ValidateGroups(state);
        ValidateNestedRepeats(state);
        ValidateDefaultRepeatExpansion(state);
        ValidateArticlePresets(presets, state);
        return state.RepeatDomains.ToDictionary(item => item.Key, item => item.Value.DefaultCount, StringComparer.Ordinal);
    }

    private static void ValidateParameterOverrides(
        IReadOnlyDictionary<string, JsonElement>? overrides,
        ValidationState state)
    {
        if (overrides is null) return;
        foreach (var (parameterId, value) in overrides)
        {
            if (!state.Parameters.TryGetValue(parameterId, out var parameter))
                Throw("Referenced parameter does not exist.", "content.parameters");
            ValidateParameterValue(value, parameter.Type, "content.parameters");
            if (parameter.Type is "number" or "integer")
            {
                if (!TryGetFiniteNumber(value, out var number) ||
                    Math.Abs(number) > MaximumCoordinateMagnitude ||
                    parameter.Minimum.HasValue && number < parameter.Minimum.Value ||
                    parameter.Maximum.HasValue && number > parameter.Maximum.Value ||
                    parameter.Type == "integer" && number != Math.Truncate(number))
                {
                    Throw("Parameter override must be a finite in-range value of its declared type.", "content.parameters");
                }
            }
            state.ParameterOverrides[parameterId] = value;
        }
    }

    private static void ValidateParameters(JsonElement parameters, ValidationState state)
    {
        var index = 0;
        foreach (var parameter in parameters.EnumerateArray())
        {
            var path = $"content.parameters[{index++}]";
            RequireExactProperties(parameter, path,
                "id", "name", "type", "unit", "defaultValue", "minimum", "maximum", "formula");
            var id = RequiredUniqueId(parameter, "id", path + ".id", state.AllIds);
            _ = RequiredShortText(parameter, "name", 256, path + ".name");
            var type = RequiredString(parameter, "type", path + ".type");
            if (type is not ("number" or "integer" or "boolean" or "string"))
                Throw("Unknown parameter type.", path + ".type");

            var unit = parameter.GetProperty("unit");
            if (unit.ValueKind is not (JsonValueKind.Null or JsonValueKind.String) ||
                unit.ValueKind == JsonValueKind.String && unit.GetString()!.Length > 32)
            {
                Throw("Parameter unit must be null or a string of at most 32 characters.", path + ".unit");
            }

            ValidateParameterValue(parameter.GetProperty("defaultValue"), type, path + ".defaultValue");
            var minimum = OptionalBoundedNumber(parameter.GetProperty("minimum"), path + ".minimum");
            var maximum = OptionalBoundedNumber(parameter.GetProperty("maximum"), path + ".maximum");
            if (minimum.HasValue && maximum.HasValue && minimum > maximum)
                Throw("Parameter minimum cannot exceed maximum.", path);

            var formula = parameter.GetProperty("formula");
            if (formula.ValueKind != JsonValueKind.Null && type is not ("number" or "integer"))
                Throw("Only numeric parameters can have formulas.", path + ".formula");
            state.Parameters.Add(id, new ParameterInfo(
                type,
                parameter.GetProperty("defaultValue"),
                formula,
                minimum,
                maximum));
        }

        foreach (var (id, parameter) in state.Parameters)
        {
            if (parameter.Formula.ValueKind != JsonValueKind.Null)
                ValidateExpression(parameter.Formula, $"content.parameters[{state.ParameterIndex(id)}].formula", state);
        }
    }

    private static void ValidateParameterCycles(IReadOnlyDictionary<string, ParameterInfo> parameters)
    {
        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.Ordinal);

        bool Visit(string id)
        {
            if (visiting.Contains(id)) return true;
            if (!visited.Add(id)) return false;
            visiting.Add(id);
            foreach (var reference in ExpressionReferences(parameters[id].Formula))
            {
                if (parameters.ContainsKey(reference) && parameters[reference].Formula.ValueKind != JsonValueKind.Null &&
                    Visit(reference)) return true;
            }
            visiting.Remove(id);
            return false;
        }

        foreach (var id in parameters.Keys)
        {
            if (Visit(id)) Throw("Parameter formulas contain a dependency cycle.", "content.parameters");
        }
    }

    private static void ValidateDefaultParameterValues(ValidationState state)
    {
        var resolved = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var (id, parameter) in state.Parameters)
        {
            if (parameter.Type is not ("number" or "integer")) continue;
            if (!TryResolveDefaultNumericParameter(
                    id,
                    state,
                    resolved,
                    new HashSet<string>(StringComparer.Ordinal),
                    out _))
            {
                var property = parameter.Formula.ValueKind == JsonValueKind.Null ? "defaultValue" : "formula";
                Throw(
                    "Numeric parameter default/formula must resolve to a finite in-range value of its declared type.",
                    $"content.parameters[{state.ParameterIndex(id)}].{property}");
            }
        }
    }

    private static void ValidateAssets(JsonElement assets, ValidationState state)
    {
        var index = 0;
        foreach (var asset in assets.EnumerateArray())
        {
            var path = $"content.assets[{index++}]";
            RequireExactProperties(asset, path, "assetId", "fileName", "mediaType", "sha256", "sizeBytes");
            var id = RequiredUniqueId(asset, "assetId", path + ".assetId", state.AllIds);
            _ = RequiredShortText(asset, "fileName", 255, path + ".fileName");
            if (RequiredString(asset, "mediaType", path + ".mediaType") != "image/png")
                Throw("Only PNG template assets are supported.", path + ".mediaType");
            var sha256 = RequiredString(asset, "sha256", path + ".sha256");
            if (!Sha256Regex().IsMatch(sha256)) Throw("Asset SHA-256 must use 64 lowercase hexadecimal characters.", path + ".sha256");
            var size = asset.GetProperty("sizeBytes");
            if (size.ValueKind != JsonValueKind.Number || !size.TryGetInt64(out var sizeBytes) ||
                sizeBytes is < 1 or > MaximumAssetBytes)
            {
                Throw($"Asset size must be between 1 and {MaximumAssetBytes} bytes.", path + ".sizeBytes");
            }
            state.AssetIds.Add(id);
        }
    }

    private static void ValidateLogicalContacts(JsonElement contacts, ValidationState state)
    {
        var numbers = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var contact in contacts.EnumerateArray())
        {
            var path = $"content.logicalContacts[{index++}]";
            RequireExactProperties(contact, path, "id", "number", "name", "contactType");
            var id = RequiredUniqueId(contact, "id", path + ".id", state.AllIds);
            var number = RequiredShortText(contact, "number", 128, path + ".number");
            if (!numbers.Add(number)) Throw("Logical contact numbers must be unique.", path + ".number");
            _ = RequiredShortText(contact, "name", 256, path + ".name");
            var contactType = RequiredString(contact, "contactType", path + ".contactType");
            if (contactType.Length > 128) Throw("Contact type cannot exceed 128 characters.", path + ".contactType");
            state.LogicalContactIds.Add(id);
            state.LogicalContacts.Add(id, new LogicalContactInfo(number));
        }
    }

    private static void ValidateRepeatDomains(JsonElement domains, ValidationState state)
    {
        var index = 0;
        foreach (var domain in domains.EnumerateArray())
        {
            var path = $"content.repeaters[{index++}]";
            RequireExactProperties(domain, path, "id", "countParameterId", "logicalContactIds");
            var id = RequiredUniqueId(domain, "id", path + ".id", state.AllIds);
            var countParameterId = RequiredId(domain, "countParameterId", path + ".countParameterId");
            long count = 0;
            if (!state.Parameters.TryGetValue(countParameterId, out var parameter) ||
                parameter.Type != "integer" || !TryResolveDefaultIntegerParameter(countParameterId, state, out count) ||
                count is < 1 or > 1_000)
            {
                Throw("Repeat count must resolve from defaults to an integer between 1 and 1000.", path + ".countParameterId");
            }
            var logicalIds = ValidateIdReferences(
                domain.GetProperty("logicalContactIds"), state.LogicalContactIds, path + ".logicalContactIds");
            state.RepeatDomains.Add(id, new RepeatDomainInfo(logicalIds, count));
        }
    }

    private static void ValidateViews(JsonElement views, ValidationState state)
    {
        var e4 = 0;
        var drawing = 0;
        var viewIndex = 0;
        foreach (var view in views.EnumerateArray())
        {
            var path = $"content.views[{viewIndex++}]";
            RequireExactProperties(view, path, ViewProperties);
            _ = RequiredUniqueId(view, "id", path + ".id", state.AllIds);
            _ = RequiredShortText(view, "name", 256, path + ".name");
            switch (RequiredString(view, "kind", path + ".kind"))
            {
                case "e4": e4++; break;
                case "drawing": drawing++; break;
                case "additional": break;
                default: Throw("View kind must be e4, drawing, or additional.", path + ".kind"); break;
            }

            var layers = RequiredArray(view, "layers", path + ".layers");
            if (layers.GetArrayLength() is < 1 or > MaximumLayersPerView)
                Throw($"A view must contain between 1 and {MaximumLayersPerView} layers.", path + ".layers");
            var viewNodeIds = new HashSet<string>(StringComparer.Ordinal);
            ValidateLayers(layers, path + ".layers", state, viewNodeIds);

            var pointLogicalIds = new Dictionary<string, string>(StringComparer.Ordinal);
            var viewContactPoints = new List<ViewContactPointInfo>();
            var contactPointIds = ValidateViewContactPoints(
                view.GetProperty("contactPoints"), path + ".contactPoints", state, pointLogicalIds, viewContactPoints);
            ValidateBundlePorts(view.GetProperty("bundlePorts"), path + ".bundlePorts", state);
            var repeatPlacements = ValidateRepeatPlacements(view.GetProperty("repeatPlacements"), path + ".repeatPlacements",
                state, viewNodeIds, contactPointIds, pointLogicalIds);
            state.RepeatViews.Add(new RepeatViewInfo(path, viewNodeIds.Count, viewContactPoints, repeatPlacements));
        }
        if (e4 != 1 || drawing != 1)
            Throw("Content must contain exactly one e4 view and exactly one drawing view.", "content.views");
        if (state.NodeCount > MaximumNodes)
            Throw($"Content cannot exceed {MaximumNodes} nodes.", "content.views");
    }

    private static void ValidateLayers(
        JsonElement layers,
        string path,
        ValidationState state,
        ISet<string> viewNodeIds)
    {
        var index = 0;
        foreach (var layer in layers.EnumerateArray())
        {
            var layerPath = $"{path}[{index++}]";
            RequireExactProperties(layer, layerPath, "id", "name", "visible", "locked", "nodes");
            var layerId = RequiredUniqueId(layer, "id", layerPath + ".id", state.AllIds);
            _ = RequiredShortText(layer, "name", 256, layerPath + ".name");
            RequireBoolean(layer, "visible", layerPath + ".visible");
            RequireBoolean(layer, "locked", layerPath + ".locked");
            var nodes = RequiredArray(layer, "nodes", layerPath + ".nodes");
            var nodeIndex = 0;
            foreach (var node in nodes.EnumerateArray())
            {
                state.NodeCount++;
                var nodePath = $"{layerPath}.nodes[{nodeIndex++}]";
                ValidateNode(node, nodePath, layerId, state, viewNodeIds);
            }
        }
    }

    private static void ValidateNode(
        JsonElement node,
        string path,
        string layerId,
        ValidationState state,
        ISet<string> viewNodeIds)
    {
        RequireExactProperties(node, path, NodeProperties);
        var id = RequiredUniqueId(node, "id", path + ".id", state.AllIds);
        viewNodeIds.Add(id);
        state.NodeLayers.Add(id, layerId);
        var kind = RequiredString(node, "kind", path + ".kind");
        var referencedLayer = RequiredId(node, "layerId", path + ".layerId");
        if (referencedLayer != layerId) Throw("Node layerId must reference its containing layer.", path + ".layerId");
        RequireBoolean(node, "visible", path + ".visible");
        RequireBoolean(node, "locked", path + ".locked");
        _ = RequiredBoundedNumber(node, "opacity", 0, 1, path + ".opacity");
        ValidateTransform(node.GetProperty("transform"), path + ".transform", state);
        ValidateStroke(node.GetProperty("stroke"), path + ".stroke", state);
        ValidateFill(node.GetProperty("fill"), path + ".fill");
        ValidateGeometry(kind, node.GetProperty("geometry"), path + ".geometry", id, layerId, state);
    }

    private static void ValidateGeometry(
        string kind,
        JsonElement geometry,
        string path,
        string nodeId,
        string layerId,
        ValidationState state)
    {
        switch (kind)
        {
            case "line":
            case "polyline":
                RequireExactProperties(geometry, path, "points", "bendRadius");
                ValidatePoints(geometry.GetProperty("points"), path + ".points", 2, 512, state);
                ValidateExpression(geometry.GetProperty("bendRadius"), path + ".bendRadius", state);
                break;
            case "rectangle":
                RequireExactProperties(geometry, path, "x", "y", "width", "height", "cornerRadii");
                ValidateExpressions(geometry, path, state, "x", "y", "width", "height");
                var radii = RequiredArray(geometry, "cornerRadii", path + ".cornerRadii");
                if (radii.GetArrayLength() != 4) Throw("Rectangle must have exactly four corner radii.", path + ".cornerRadii");
                var radiusIndex = 0;
                foreach (var radius in radii.EnumerateArray())
                    ValidateExpression(radius, $"{path}.cornerRadii[{radiusIndex++}]", state);
                break;
            case "ellipse":
                RequireExactProperties(geometry, path, "centerX", "centerY", "radiusX", "radiusY");
                ValidateExpressions(geometry, path, state, "centerX", "centerY", "radiusX", "radiusY");
                break;
            case "bezier":
                RequireExactProperties(geometry, path, "points", "closed");
                var bezierPoints = RequiredArray(geometry, "points", path + ".points");
                if (bezierPoints.GetArrayLength() is < 4 or > 514 || (bezierPoints.GetArrayLength() - 1) % 3 != 0)
                    Throw("Bezier geometry requires 1+3n control points and at most 514 points.", path + ".points");
                ValidatePointArray(bezierPoints, path + ".points", state);
                RequireBoolean(geometry, "closed", path + ".closed");
                break;
            case "closedContour":
                RequireExactProperties(geometry, path, "points");
                ValidatePoints(geometry.GetProperty("points"), path + ".points", 3, 512, state);
                break;
            case "text":
                RequireExactProperties(geometry, path, "x", "y", "text", "fontSize");
                ValidateExpressions(geometry, path, state, "x", "y", "fontSize");
                var text = RequiredString(geometry, "text", path + ".text");
                if (text.Length > 4_096) Throw("Text cannot exceed 4096 characters.", path + ".text");
                break;
            case "image":
                RequireExactProperties(geometry, path,
                    "assetId", "x", "y", "width", "height", "cropX", "cropY", "cropWidth", "cropHeight", "underlay");
                var assetId = RequiredId(geometry, "assetId", path + ".assetId");
                if (!state.AssetIds.Contains(assetId)) Throw("Referenced asset does not exist.", path + ".assetId");
                ValidateExpressions(geometry, path, state, "x", "y", "width", "height");
                foreach (var property in new[] { "cropX", "cropY", "cropWidth", "cropHeight" })
                    _ = RequiredBoundedNumber(geometry, property, 0, 1, path + "." + property);
                RequireBoolean(geometry, "underlay", path + ".underlay");
                break;
            case "group":
                RequireExactProperties(geometry, path, "childIds");
                var children = RequiredArray(geometry, "childIds", path + ".childIds");
                if (children.GetArrayLength() == 0) Throw("A group must have at least one child.", path + ".childIds");
                var childIds = new List<string>();
                var childIndex = 0;
                foreach (var child in children.EnumerateArray())
                {
                    if (child.ValueKind != JsonValueKind.String)
                        Throw("Group child IDs must be strings.", $"{path}.childIds[{childIndex}]");
                    childIds.Add(child.GetString()!);
                    childIndex++;
                }
                state.Groups.Add(nodeId, new GroupInfo(layerId, childIds));
                break;
            default:
                Throw("Unknown template node kind.", path[..^".geometry".Length] + ".kind");
                break;
        }
    }

    private static HashSet<string> ValidateViewContactPoints(
        JsonElement points,
        string path,
        ValidationState state,
        IDictionary<string, string> pointLogicalIds,
        ICollection<ViewContactPointInfo> viewContactPoints)
    {
        if (points.ValueKind != JsonValueKind.Array) Throw("Contact points must be an array.", path);
        var result = new HashSet<string>(StringComparer.Ordinal);
        var logicalIdsInView = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var point in points.EnumerateArray())
        {
            var pointPath = $"{path}[{index++}]";
            RequireExactProperties(point, pointPath, "id", "logicalContactId", "x", "y", "direction");
            var id = RequiredUniqueId(point, "id", pointPath + ".id", state.AllIds);
            result.Add(id);
            var logicalId = RequiredId(point, "logicalContactId", pointPath + ".logicalContactId");
            if (!state.LogicalContactIds.Contains(logicalId)) Throw("Referenced logical contact does not exist.", pointPath + ".logicalContactId");
            if (!logicalIdsInView.Add(logicalId)) Throw("A view can contain only one point for each logical contact.", pointPath + ".logicalContactId");
            pointLogicalIds.Add(id, logicalId);
            viewContactPoints.Add(new ViewContactPointInfo(id, logicalId));
            ValidateExpression(point.GetProperty("x"), pointPath + ".x", state);
            ValidateExpression(point.GetProperty("y"), pointPath + ".y", state);
            ValidateDirection(point, pointPath);
        }
        return result;
    }

    private static void ValidateBundlePorts(JsonElement ports, string path, ValidationState state)
    {
        if (ports.ValueKind != JsonValueKind.Array) Throw("Bundle ports must be an array.", path);
        var index = 0;
        foreach (var port in ports.EnumerateArray())
        {
            var portPath = $"{path}[{index++}]";
            RequireExactProperties(port, portPath, "id", "name", "x", "y", "direction");
            _ = RequiredUniqueId(port, "id", portPath + ".id", state.AllIds);
            _ = RequiredShortText(port, "name", 256, portPath + ".name");
            ValidateExpression(port.GetProperty("x"), portPath + ".x", state);
            ValidateExpression(port.GetProperty("y"), portPath + ".y", state);
            ValidateDirection(port, portPath);
        }
    }

    private static IReadOnlyList<RepeatPlacementInfo> ValidateRepeatPlacements(
        JsonElement placements,
        string path,
        ValidationState state,
        ISet<string> viewNodeIds,
        ISet<string> contactPointIds,
        IReadOnlyDictionary<string, string> pointLogicalIds)
    {
        if (placements.ValueKind != JsonValueKind.Array) Throw("Repeat placements must be an array.", path);
        var domainsInView = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<RepeatPlacementInfo>();
        var index = 0;
        foreach (var placement in placements.EnumerateArray())
        {
            var placementPath = $"{path}[{index++}]";
            RequireExactProperties(placement, placementPath,
                "repeatDomainId", "prototypeGroupId", "step", "contactPointIds");
            var domainId = RequiredId(placement, "repeatDomainId", placementPath + ".repeatDomainId");
            if (!state.RepeatDomains.TryGetValue(domainId, out var domain))
                Throw("Referenced repeat domain does not exist.", placementPath + ".repeatDomainId");
            if (!domainsInView.Add(domainId))
                Throw("A repeat domain can have only one placement in a view.", placementPath + ".repeatDomainId");
            var prototypeId = RequiredId(placement, "prototypeGroupId", placementPath + ".prototypeGroupId");
            if (!viewNodeIds.Contains(prototypeId) || !state.Groups.ContainsKey(prototypeId))
                Throw("Repeat prototype must reference a group in the same view.", placementPath + ".prototypeGroupId");
            if (!state.RepeatedGroups.Add(prototypeId))
                Throw("A prototype group cannot be used by more than one repeat placement.", placementPath + ".prototypeGroupId");
            var step = placement.GetProperty("step");
            ValidatePoint(step, placementPath + ".step", state);
            var pointIds = ValidateIdReferences(
                placement.GetProperty("contactPointIds"), contactPointIds, placementPath + ".contactPointIds");
            var orderedPointIds = placement.GetProperty("contactPointIds").EnumerateArray()
                .Select(point => point.GetString()!)
                .ToArray();
            var logicalIds = new List<string>(orderedPointIds.Length);
            var pointIndex = 0;
            foreach (var pointId in orderedPointIds)
            {
                if (pointLogicalIds.TryGetValue(pointId, out var logicalId) && !domain.LogicalContactIds.Contains(logicalId))
                    Throw("Repeat point must belong to a logical contact in its repeat domain.", $"{placementPath}.contactPointIds[{pointIndex}]");
                logicalIds.Add(logicalId!);
                pointIndex++;
            }
            result.Add(new RepeatPlacementInfo(
                domainId,
                prototypeId,
                pointIds,
                logicalIds,
                step.GetProperty("x"),
                step.GetProperty("y"),
                placementPath));
        }
        return result;
    }

    private static void ValidateGroups(ValidationState state)
    {
        var owners = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (groupId, group) in state.Groups)
        {
            foreach (var childId in group.ChildIds)
            {
                if (!state.NodeLayers.TryGetValue(childId, out var childLayer))
                    Throw("Group child does not exist.", $"group:{groupId}");
                if (childLayer != group.LayerId)
                    Throw("A group cannot own a node from another layer.", $"group:{groupId}");
                if (owners.TryGetValue(childId, out var owner) && owner != groupId)
                    Throw("A node cannot be owned by multiple groups.", $"group:{groupId}");
                owners[childId] = groupId;
            }
        }

        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.Ordinal);
        bool Visit(string id)
        {
            if (visiting.Contains(id)) return true;
            if (!visited.Add(id)) return false;
            visiting.Add(id);
            foreach (var child in state.Groups[id].ChildIds)
            {
                if (state.Groups.ContainsKey(child) && Visit(child)) return true;
            }
            visiting.Remove(id);
            return false;
        }
        foreach (var id in state.Groups.Keys)
        {
            if (Visit(id)) Throw("Template groups contain a cycle.", $"group:{id}");
        }
    }

    private static void ValidateNestedRepeats(ValidationState state)
    {
        bool ContainsRepeatedDescendant(string groupId, ISet<string> visited)
        {
            if (!visited.Add(groupId)) return false;
            foreach (var child in state.Groups[groupId].ChildIds)
            {
                if (state.RepeatedGroups.Contains(child)) return true;
                if (state.Groups.ContainsKey(child) && ContainsRepeatedDescendant(child, visited)) return true;
            }
            return false;
        }

        foreach (var prototype in state.RepeatedGroups)
        {
            if (ContainsRepeatedDescendant(prototype, new HashSet<string>(StringComparer.Ordinal)))
                Throw("Nested repeat placements are not supported.", $"group:{prototype}");
        }
    }

    private static void ValidateDefaultRepeatExpansion(ValidationState state)
    {
        long expandedNodes = 0;
        long expandedContacts = 0;
        foreach (var view in state.RepeatViews)
        {
            var prototypePointIds = view.Placements
                .SelectMany(placement => placement.ContactPointIds)
                .ToHashSet(StringComparer.Ordinal);
            var prototypeNodeIds = new HashSet<string>(StringComparer.Ordinal);
            long repeatedNodes = 0;
            long repeatedContacts = 0;
            var displayedNumbers = new Dictionary<string, string>(StringComparer.Ordinal);

            void RegisterNumber(string number, string owner, string path)
            {
                var normalized = number.Trim();
                if (displayedNumbers.TryGetValue(normalized, out var previous) && previous != owner)
                {
                    Throw(
                        $"Expanded contact number '{normalized}' collides with another displayed contact in the same view.",
                        path);
                }
                displayedNumbers[normalized] = owner;
            }

            foreach (var point in view.ContactPoints)
            {
                if (prototypePointIds.Contains(point.Id)) continue;
                RegisterNumber(
                    state.LogicalContacts[point.LogicalContactId].Number,
                    $"point:{point.Id}",
                    view.Path + ".contactPoints");
            }

            foreach (var placement in view.Placements)
            {
                var domain = state.RepeatDomains[placement.DomainId];
                var stepX = double.NaN;
                var stepY = double.NaN;
                if (!TryEvaluateDefaultExpression(
                        placement.StepX,
                        state,
                        new Dictionary<string, double>(StringComparer.Ordinal),
                        new HashSet<string>(StringComparer.Ordinal),
                        out stepX) ||
                    !TryEvaluateDefaultExpression(
                        placement.StepY,
                        state,
                        new Dictionary<string, double>(StringComparer.Ordinal),
                        new HashSet<string>(StringComparer.Ordinal),
                        out stepY))
                {
                    Throw("Repeat step cannot be resolved from default parameter values.", placement.Path + ".step");
                }
                var lastOffsetX = (domain.DefaultCount - 1) * stepX;
                var lastOffsetY = (domain.DefaultCount - 1) * stepY;
                if (!double.IsFinite(lastOffsetX) || !double.IsFinite(lastOffsetY) ||
                    Math.Abs(lastOffsetX) > MaximumCoordinateMagnitude ||
                    Math.Abs(lastOffsetY) > MaximumCoordinateMagnitude)
                {
                    Throw("Default repeat offset exceeds the allowed coordinate range.", placement.Path + ".step");
                }
                var members = GroupMembers(placement.PrototypeGroupId, state.Groups);
                prototypeNodeIds.UnionWith(members);
                repeatedNodes += (long)domain.DefaultCount * members.Count;
                repeatedContacts += (long)domain.DefaultCount * placement.ContactPointIds.Count;

                var domainOrder = domain.LogicalContactIds
                    .Select((logicalId, order) => (logicalId, order))
                    .ToDictionary(item => item.logicalId, item => item.order, StringComparer.Ordinal);
                var orderedLogicalIds = placement.LogicalContactIds
                    .Select((logicalId, placementOrder) => (logicalId, placementOrder))
                    .OrderBy(item => domainOrder[item.logicalId])
                    .ThenBy(item => item.placementOrder)
                    .Select(item => item.logicalId)
                    .ToArray();
                var stride = domain.LogicalContactIds.Count;
                for (var occurrence = 0L; occurrence < domain.DefaultCount; occurrence++)
                {
                    foreach (var logicalId in orderedLogicalIds)
                    {
                        var logical = state.LogicalContacts[logicalId];
                        var number = ExpandedContactNumber(logical.Number, occurrence, stride);
                        RegisterNumber(
                            number,
                            $"repeat:{placement.DomainId}:{occurrence}:{logicalId}",
                            placement.Path + ".contactPointIds");
                    }
                }
            }
            expandedNodes += view.NodeCount - prototypeNodeIds.Count + repeatedNodes;
            expandedContacts += view.ContactPoints.Count - prototypePointIds.Count + repeatedContacts;
            if (expandedNodes > MaximumNodes || expandedContacts > MaximumLogicalContacts)
            {
                Throw(
                    $"Default repeat expansion cannot exceed {MaximumNodes} nodes or {MaximumLogicalContacts} contact points across all views.",
                    view.Path + ".repeatPlacements");
            }
        }
    }

    private static IReadOnlySet<string> GroupMembers(string groupId, IReadOnlyDictionary<string, GroupInfo> groups)
    {
        var descendants = new HashSet<string>(StringComparer.Ordinal);
        void Visit(string id)
        {
            if (!descendants.Add(id)) return;
            if (!groups.TryGetValue(id, out var group)) return;
            foreach (var childId in group.ChildIds) Visit(childId);
        }
        Visit(groupId);
        return descendants;
    }

    private static string ExpandedContactNumber(string prototype, long occurrence, int stride)
    {
        if (prototype.Length > 0 && prototype.All(char.IsAsciiDigit) &&
            (prototype == "0" || prototype[0] != '0') &&
            long.TryParse(prototype, out var numeric))
        {
            var offset = checked(occurrence * stride);
            if (numeric <= MaximumSafeInteger - offset) return (numeric + offset).ToString();
        }
        return $"{prototype}-{occurrence + 1}";
    }

    private static bool TryResolveDefaultIntegerParameter(
        string parameterId,
        ValidationState state,
        out long value)
    {
        value = default;
        if (!TryResolveDefaultNumericParameter(
                parameterId,
                state,
                new Dictionary<string, double>(StringComparer.Ordinal),
                new HashSet<string>(StringComparer.Ordinal),
                out var resolved) ||
            resolved < -MaximumSafeInteger || resolved > MaximumSafeInteger || resolved != Math.Truncate(resolved))
        {
            return false;
        }
        value = (long)resolved;
        return true;
    }

    private static bool TryResolveDefaultNumericParameter(
        string parameterId,
        ValidationState state,
        IDictionary<string, double> resolved,
        ISet<string> resolving,
        out double value)
    {
        value = default;
        if (resolved.TryGetValue(parameterId, out value)) return true;
        if (!state.Parameters.TryGetValue(parameterId, out var parameter) ||
            parameter.Type is not ("number" or "integer") || !resolving.Add(parameterId))
        {
            return false;
        }
        try
        {
            if (state.ParameterOverrides.TryGetValue(parameterId, out var overridden))
            {
                if (!TryGetFiniteNumber(overridden, out value)) return false;
            }
            else if (parameter.Formula.ValueKind == JsonValueKind.Null)
            {
                if (!TryGetFiniteNumber(parameter.DefaultValue, out value)) return false;
            }
            else if (!TryEvaluateDefaultExpression(parameter.Formula, state, resolved, resolving, out value))
            {
                return false;
            }
            if (!double.IsFinite(value) || Math.Abs(value) > MaximumCoordinateMagnitude ||
                parameter.Minimum.HasValue && value < parameter.Minimum.Value ||
                parameter.Maximum.HasValue && value > parameter.Maximum.Value ||
                parameter.Type == "integer" && value != Math.Truncate(value))
            {
                return false;
            }
            resolved[parameterId] = value;
            return true;
        }
        finally
        {
            resolving.Remove(parameterId);
        }
    }

    private static bool TryEvaluateDefaultExpression(
        JsonElement expression,
        ValidationState state,
        IDictionary<string, double> resolved,
        ISet<string> resolving,
        out double value)
    {
        value = default;
        switch (expression.GetProperty("kind").GetString())
        {
            case "constant":
                return TryGetFiniteNumber(expression.GetProperty("value"), out value);
            case "parameter":
                return TryResolveDefaultNumericParameter(
                    expression.GetProperty("parameterId").GetString()!, state, resolved, resolving, out value);
            case "negate":
                if (!TryEvaluateDefaultExpression(expression.GetProperty("operand"), state, resolved, resolving, out var operand))
                    return false;
                value = -operand;
                break;
            case "binary":
                if (!TryEvaluateDefaultExpression(expression.GetProperty("left"), state, resolved, resolving, out var left) ||
                    !TryEvaluateDefaultExpression(expression.GetProperty("right"), state, resolved, resolving, out var right))
                {
                    return false;
                }
                value = expression.GetProperty("operator").GetString() switch
                {
                    "add" => left + right,
                    "subtract" => left - right,
                    "multiply" => left * right,
                    "divide" when right != 0 => left / right,
                    _ => double.NaN,
                };
                break;
            default:
                return false;
        }
        return double.IsFinite(value) && Math.Abs(value) <= MaximumCoordinateMagnitude;
    }

    private static void ValidateArticlePresets(JsonElement presets, ValidationState state)
    {
        var index = 0;
        foreach (var preset in presets.EnumerateArray())
        {
            var path = $"content.articleParameterPresets[{index++}]";
            RequireExactProperties(preset, path, "id", "sourceId", "entityType", "articleKey", "values");
            _ = RequiredUniqueId(preset, "id", path + ".id", state.AllIds);
            _ = RequiredShortText(preset, "sourceId", 128, path + ".sourceId");
            _ = RequiredShortText(preset, "entityType", 64, path + ".entityType");
            _ = RequiredShortText(preset, "articleKey", 512, path + ".articleKey");
            var values = RequiredArray(preset, "values", path + ".values");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var valueIndex = 0;
            foreach (var value in values.EnumerateArray())
            {
                var valuePath = $"{path}.values[{valueIndex++}]";
                RequireExactProperties(value, valuePath, "parameterId", "value");
                var parameterId = RequiredId(value, "parameterId", valuePath + ".parameterId");
                if (!state.Parameters.TryGetValue(parameterId, out var parameter))
                    Throw("Referenced parameter does not exist.", valuePath + ".parameterId");
                if (!seen.Add(parameterId)) Throw("A preset cannot assign a parameter twice.", valuePath + ".parameterId");
                ValidateParameterValue(value.GetProperty("value"), parameter.Type, valuePath + ".value");
            }
        }
    }

    private static void ValidateExpression(JsonElement expression, string path, ValidationState state)
    {
        var budget = new ExpressionBudget();
        ValidateExpression(expression, path, state, budget, 1);
    }

    private static void ValidateExpression(
        JsonElement expression,
        string path,
        ValidationState state,
        ExpressionBudget budget,
        int depth)
    {
        budget.Nodes++;
        if (depth > MaximumExpressionDepth || budget.Nodes > MaximumExpressionNodes)
            Throw("Expression exceeds the maximum depth or node count.", path);
        if (expression.ValueKind != JsonValueKind.Object) Throw("A typed numeric expression is required.", path);
        if (!expression.TryGetProperty("kind", out var kindElement)) Throw("A typed numeric expression is required.", path);
        if (kindElement.ValueKind != JsonValueKind.String)
            Throw("A typed numeric expression is required.", path);
        switch (kindElement.GetString())
        {
            case "constant":
                RequireExactProperties(expression, path, "kind", "value");
                _ = RequiredBoundedNumber(expression, "value", -MaximumCoordinateMagnitude, MaximumCoordinateMagnitude, path + ".value");
                break;
            case "parameter":
                RequireExactProperties(expression, path, "kind", "parameterId");
                var parameterId = RequiredId(expression, "parameterId", path + ".parameterId");
                if (!state.Parameters.TryGetValue(parameterId, out var parameter) || parameter.Type is not ("number" or "integer"))
                    Throw("Expression must reference an existing numeric parameter.", path + ".parameterId");
                break;
            case "negate":
                RequireExactProperties(expression, path, "kind", "operand");
                ValidateExpression(expression.GetProperty("operand"), path + ".operand", state, budget, depth + 1);
                break;
            case "binary":
                RequireExactProperties(expression, path, "kind", "operator", "left", "right");
                var operation = RequiredString(expression, "operator", path + ".operator");
                if (operation is not ("add" or "subtract" or "multiply" or "divide"))
                    Throw("Unknown binary expression operator.", path + ".operator");
                ValidateExpression(expression.GetProperty("left"), path + ".left", state, budget, depth + 1);
                ValidateExpression(expression.GetProperty("right"), path + ".right", state, budget, depth + 1);
                if (operation == "divide" && IsZeroConstant(expression.GetProperty("right")))
                    Throw("Division by a zero constant is not allowed.", path + ".right");
                break;
            default:
                Throw("Unknown expression kind.", path + ".kind");
                break;
        }
    }

    private static IEnumerable<string> ExpressionReferences(JsonElement expression)
    {
        if (expression.ValueKind != JsonValueKind.Object || !expression.TryGetProperty("kind", out var kind)) yield break;
        if (kind.GetString() == "parameter" && expression.TryGetProperty("parameterId", out var parameterId) &&
            parameterId.ValueKind == JsonValueKind.String)
        {
            yield return parameterId.GetString()!;
        }
        if (kind.GetString() == "negate" && expression.TryGetProperty("operand", out var operand))
        {
            foreach (var reference in ExpressionReferences(operand)) yield return reference;
        }
        if (kind.GetString() == "binary")
        {
            if (expression.TryGetProperty("left", out var left))
                foreach (var reference in ExpressionReferences(left)) yield return reference;
            if (expression.TryGetProperty("right", out var right))
                foreach (var reference in ExpressionReferences(right)) yield return reference;
        }
    }

    private static void ValidateTransform(JsonElement transform, string path, ValidationState state)
    {
        RequireExactProperties(transform, path, "translateX", "translateY", "rotationDegrees", "scaleX", "scaleY");
        ValidateExpressions(transform, path, state, "translateX", "translateY", "rotationDegrees", "scaleX", "scaleY");
    }

    private static void ValidateStroke(JsonElement stroke, string path, ValidationState state)
    {
        if (stroke.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var actual = stroke.EnumerateObject().Select(property => property.Name).ToArray();
        var allowed = new HashSet<string>(["color", "width", "dash"], StringComparer.Ordinal);
        if (actual.Distinct(StringComparer.Ordinal).Count() != actual.Length ||
            actual.Any(property => !allowed.Contains(property)) ||
            !actual.Contains("color", StringComparer.Ordinal) || !actual.Contains("width", StringComparer.Ordinal))
            Throw("Object has missing, extra, or duplicate properties.", path);
        ValidateColor(stroke.GetProperty("color"), path + ".color", allowNull: false);
        ValidateExpression(stroke.GetProperty("width"), path + ".width", state);
        if (stroke.TryGetProperty("dash", out var dash) &&
            (dash.ValueKind != JsonValueKind.String || dash.GetString() is not ("solid" or "dash" or "dot" or "dash-dot")))
            Throw("Stroke dash must be solid, dash, dot, or dash-dot.", path + ".dash");
    }

    private static void ValidateFill(JsonElement fill, string path)
    {
        RequireExactProperties(fill, path, "color");
        ValidateColor(fill.GetProperty("color"), path + ".color", allowNull: true);
    }

    private static void ValidateColor(JsonElement color, string path, bool allowNull)
    {
        if (allowNull && color.ValueKind == JsonValueKind.Null) return;
        if (color.ValueKind != JsonValueKind.String || !ColorRegex().IsMatch(color.GetString()!))
            Throw("Color must be #RRGGBB, #RRGGBBAA, or null where permitted.", path);
    }

    private static void ValidatePoints(
        JsonElement points,
        string path,
        int minimum,
        int maximum,
        ValidationState state)
    {
        if (points.ValueKind != JsonValueKind.Array || points.GetArrayLength() < minimum || points.GetArrayLength() > maximum)
            Throw($"Point count must be between {minimum} and {maximum}.", path);
        ValidatePointArray(points, path, state);
    }

    private static void ValidatePointArray(JsonElement points, string path, ValidationState state)
    {
        var index = 0;
        foreach (var point in points.EnumerateArray()) ValidatePoint(point, $"{path}[{index++}]", state);
    }

    private static void ValidatePoint(JsonElement point, string path, ValidationState state)
    {
        RequireExactProperties(point, path, "x", "y");
        ValidateExpression(point.GetProperty("x"), path + ".x", state);
        ValidateExpression(point.GetProperty("y"), path + ".y", state);
    }

    private static void ValidateExpressions(JsonElement owner, string path, ValidationState state, params string[] properties)
    {
        foreach (var property in properties) ValidateExpression(owner.GetProperty(property), path + "." + property, state);
    }

    private static void ValidateDirection(JsonElement owner, string path)
    {
        var direction = RequiredString(owner, "direction", path + ".direction");
        if (direction is not ("left" or "right" or "up" or "down"))
            Throw("Direction must be left, right, up, or down.", path + ".direction");
    }

    private static HashSet<string> ValidateIdReferences(JsonElement values, ISet<string> validIds, string path)
    {
        if (values.ValueKind != JsonValueKind.Array) Throw("ID references must be an array.", path);
        var result = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var value in values.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            var id = RequiredId(value, itemPath);
            if (!validIds.Contains(id)) Throw("Referenced ID does not exist.", itemPath);
            if (!result.Add(id)) Throw("An ID reference cannot be repeated.", itemPath);
        }
        return result;
    }

    private static void ValidateParameterValue(JsonElement value, string type, string path)
    {
        var valid = type switch
        {
            "number" => TryGetFiniteNumber(value, out _),
            "integer" => TryGetSafeInteger(value, out _),
            "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
            "string" => value.ValueKind == JsonValueKind.String && value.GetString()!.Length <= 1_024,
            _ => false,
        };
        if (!valid) Throw("Parameter value does not match its declared type.", path);
    }

    private static double? OptionalBoundedNumber(JsonElement value, string path)
    {
        if (value.ValueKind == JsonValueKind.Null) return null;
        if (!TryGetFiniteNumber(value, out var number) || Math.Abs(number) > MaximumCoordinateMagnitude)
            Throw("A null or bounded finite number is required.", path);
        return number;
    }

    private static JsonElement RequiredArray(JsonElement owner, string property, string path)
    {
        var value = owner.GetProperty(property);
        if (value.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        return value;
    }

    private static void RequireMaximum(JsonElement array, int maximum, string path)
    {
        if (array.GetArrayLength() > maximum) Throw($"Array cannot contain more than {maximum} items.", path);
    }

    private static string RequiredUniqueId(JsonElement owner, string property, string path, ISet<string> allIds)
    {
        var id = RequiredId(owner, property, path);
        if (!allIds.Add(id)) Throw("Template IDs must be globally unique.", path);
        return id;
    }

    private static string RequiredId(JsonElement owner, string property, string path) =>
        RequiredId(owner.GetProperty(property), path);

    private static string RequiredId(JsonElement value, string path)
    {
        if (value.ValueKind != JsonValueKind.String || !UuidRegex().IsMatch(value.GetString()!))
            Throw("A canonical UUID is required.", path);
        return value.GetString()!;
    }

    private static string RequiredShortText(JsonElement owner, string property, int maximum, string path)
    {
        var value = RequiredString(owner, property, path);
        if (value.Length > maximum || string.IsNullOrWhiteSpace(value) || value.Any(char.IsControl))
            Throw($"A non-empty string of at most {maximum} characters is required.", path);
        return value;
    }

    private static string RequiredString(JsonElement owner, string property, string path)
    {
        var value = owner.GetProperty(property);
        if (value.ValueKind != JsonValueKind.String) Throw("A string is required.", path);
        return value.GetString()!;
    }

    private static void RequireBoolean(JsonElement owner, string property, string path)
    {
        if (owner.GetProperty(property).ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            Throw("A Boolean value is required.", path);
    }

    private static double RequiredBoundedNumber(
        JsonElement owner,
        string property,
        double minimum,
        double maximum,
        string path)
    {
        var value = owner.GetProperty(property);
        if (!TryGetFiniteNumber(value, out var number) || number < minimum || number > maximum)
            Throw($"A finite number between {minimum} and {maximum} is required.", path);
        return number;
    }

    private static bool TryGetFiniteNumber(JsonElement value, out double number)
    {
        number = default;
        return value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out number) && double.IsFinite(number);
    }

    private static bool TryGetSafeInteger(JsonElement value, out long number)
    {
        number = default;
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out number) && Math.Abs(number) <= MaximumSafeInteger;
    }

    private static bool IsZeroConstant(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty("kind", out var kind) &&
        kind.ValueKind == JsonValueKind.String && kind.GetString() == "constant" &&
        value.TryGetProperty("value", out var number) && TryGetFiniteNumber(number, out var result) && result == 0;

    private static void RequireExactProperties(JsonElement value, string path, params string[] expected)
    {
        if (value.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var actual = value.EnumerateObject().Select(property => property.Name).ToArray();
        if (actual.Length != expected.Length || actual.Distinct(StringComparer.Ordinal).Count() != actual.Length ||
            !actual.Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal)))
        {
            Throw("Object has missing, extra, or duplicate properties.", path);
        }
    }

    [DoesNotReturn]
    private static void Throw(string message, string path) =>
        throw new ComponentTemplateException("component_template_content_invalid", message, path);

    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UuidRegex();

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Regex();

    [GeneratedRegex("^#[0-9a-f]{6}([0-9a-f]{2})?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ColorRegex();

    private sealed class ValidationState
    {
        internal HashSet<string> AllIds { get; } = new(StringComparer.Ordinal);
        internal HashSet<string> AssetIds { get; } = new(StringComparer.Ordinal);
        internal HashSet<string> LogicalContactIds { get; } = new(StringComparer.Ordinal);
        internal Dictionary<string, LogicalContactInfo> LogicalContacts { get; } = new(StringComparer.Ordinal);
        internal Dictionary<string, ParameterInfo> Parameters { get; } = new(StringComparer.Ordinal);
        internal Dictionary<string, JsonElement> ParameterOverrides { get; } = new(StringComparer.Ordinal);
        internal Dictionary<string, RepeatDomainInfo> RepeatDomains { get; } = new(StringComparer.Ordinal);
        internal Dictionary<string, GroupInfo> Groups { get; } = new(StringComparer.Ordinal);
        internal Dictionary<string, string> NodeLayers { get; } = new(StringComparer.Ordinal);
        internal HashSet<string> RepeatedGroups { get; } = new(StringComparer.Ordinal);
        internal List<RepeatViewInfo> RepeatViews { get; } = [];
        internal int NodeCount { get; set; }

        internal int ParameterIndex(string id)
        {
            var index = 0;
            foreach (var key in Parameters.Keys)
            {
                if (key == id) return index;
                index++;
            }
            return -1;
        }
    }

    private sealed class ExpressionBudget
    {
        internal int Nodes { get; set; }
    }

    private sealed record ParameterInfo(
        string Type,
        JsonElement DefaultValue,
        JsonElement Formula,
        double? Minimum,
        double? Maximum);
    private sealed record LogicalContactInfo(string Number);
    private sealed record RepeatDomainInfo(IReadOnlySet<string> LogicalContactIds, long DefaultCount);
    private sealed record ViewContactPointInfo(string Id, string LogicalContactId);
    private sealed record RepeatPlacementInfo(
        string DomainId,
        string PrototypeGroupId,
        IReadOnlySet<string> ContactPointIds,
        IReadOnlyList<string> LogicalContactIds,
        JsonElement StepX,
        JsonElement StepY,
        string Path);
    private sealed record RepeatViewInfo(
        string Path,
        int NodeCount,
        IReadOnlyList<ViewContactPointInfo> ContactPoints,
        IReadOnlyList<RepeatPlacementInfo> Placements);
    private sealed record GroupInfo(string LayerId, IReadOnlyList<string> ChildIds);
}
