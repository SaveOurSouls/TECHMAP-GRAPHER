using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>Validates production termination references without relying on the active UI or catalogue.</summary>
internal static class HarnessTerminationValidator
{
    private static readonly HashSet<string> PreparationModes = new(StringComparer.Ordinal)
        { "cut", "copper", "tin", "pin", "socket", "pin-sealed", "socket-sealed", "lug" };

    internal static void Validate(JsonElement design, bool allowDetachedDrawingEndpoints = false)
    {
        var connectors = Index(design, "connectors", "content");
        var wires = Index(design, "wires", "content");
        var artifacts = new Dictionary<string, (JsonElement Value, string Path)>(StringComparer.Ordinal);
        JsonElement terminationDocument = default;
        var hasDocument = design.TryGetProperty("terminations", out terminationDocument);
        var groups = new Dictionary<string, (JsonElement Value, string Path)>(StringComparer.Ordinal);
        var preparations = new Dictionary<string, (JsonElement Value, string Path)>(StringComparer.Ordinal);
        var operations = new Dictionary<string, (JsonElement Value, string Path)>(StringComparer.Ordinal);
        var twists = new Dictionary<string, (JsonElement Value, string Path)>(StringComparer.Ordinal);
        var terminalArtifactTargets = new Dictionary<string, string>(StringComparer.Ordinal);

        if (hasDocument)
        {
            RequireObject(terminationDocument, "content.terminations");
            if (!terminationDocument.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var parsedVersion) || parsedVersion != 1)
                throw Invalid("Unsupported termination document version.", "content.terminations.version");
            artifacts = Index(terminationDocument, "artifacts", "content.terminations");
            groups = Index(terminationDocument, "groups", "content.terminations");
            preparations = Index(terminationDocument, "endPreparations", "content.terminations");
            operations = Index(terminationDocument, "operations", "content.terminations");
            twists = Index(terminationDocument, "twists", "content.terminations");
            var allIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var collection in new[] { artifacts, groups, preparations, operations, twists })
                foreach (var id in collection.Keys)
                    if (!allIds.Add(id)) throw Invalid("Termination IDs must be unique across the document.", "content.terminations");
            ValidateArtifacts(artifacts);
        }

        foreach (var (connectorId, connector) in connectors)
        {
            if (!connector.Value.TryGetProperty("terminationComponent", out var component)) continue;
            var path = connector.Path + ".terminationComponent";
            RequireObject(component, path);
            var kind = Text(component, "kind", path);
            if (kind is not ("terminal" or "sleeve" or "preparation")) throw Invalid("Unknown termination component kind.", path + ".kind");
            _ = Text(component, "symbolId", path);
            if (!connector.Value.TryGetProperty("contacts", out var contacts) || contacts.ValueKind != JsonValueKind.Array)
                throw Invalid("A termination component requires explicit contacts.", connector.Path + ".contacts");
            var expected = kind == "sleeve" ? 2 : 1;
            if (contacts.GetArrayLength() != expected) throw Invalid("A sleeve requires two contacts; a terminal or preparation requires one.", connector.Path + ".contacts");
            if (component.TryGetProperty("preparationMode", out var mode) &&
                (mode.ValueKind != JsonValueKind.String || !PreparationModes.Contains(mode.GetString()!)))
                throw Invalid("Unknown termination preparation mode.", path + ".preparationMode");
            if (component.TryGetProperty("conductive", out var conductive) && conductive.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw Invalid("Termination conductivity must be boolean.", path + ".conductive");
            if (component.TryGetProperty("catalogBinding", out var componentBinding)) ValidateCatalogBinding(componentBinding, path + ".catalogBinding");
            if (component.TryGetProperty("artifactId", out var artifactId))
            {
                var id = String(artifactId, path + ".artifactId");
                var expectedKind = kind == "sleeve" ? "sleeve" : "terminal";
                RequireArtifact(id, expectedKind, artifacts, path + ".artifactId");
                var contact = contacts[0];
                var contactId = Text(contact, "id", connector.Path + ".contacts[0]");
                var identity = kind == "sleeve" ? "sleeve:" + connectorId : ContactKey(connectorId, contactId);
                BindTerminalArtifact(id, identity, terminalArtifactTargets, path + ".artifactId");
            }
        }

        if (!hasDocument) return;

        var usedMembers = new HashSet<string>(StringComparer.Ordinal);
        var groupArtifactByMember = new Dictionary<string, string>(StringComparer.Ordinal);
        var usedTargets = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (id, group) in groups)
        {
            var path = group.Path;
            if (Text(group.Value, "id", path) != id) throw Invalid("Invalid termination group.", path);
            var target = Required(group.Value, "target", path);
            RequireObject(target, path + ".target");
            var connectorId = Text(target, "connectorId", path + ".target");
            var contactId = Text(target, "contactId", path + ".target");
            if (!connectors.TryGetValue(connectorId, out var connector) || !ContactExists(connector.Value, contactId) || IsDisconnected(connector.Value, contactId))
                throw Invalid("Termination group target must be a connected contact.", path + ".target");
            var targetKey = connectorId + "\u001f" + contactId;
            if (!usedTargets.Add(targetKey)) throw Invalid("Only one termination group may target a contact.", path + ".target");
            var artifactId = Text(group.Value, "artifactId", path);
            if (!artifacts.TryGetValue(artifactId, out var groupArtifact)) throw Invalid("Termination artifact is missing.", path + ".artifactId");
            if (connector.Value.TryGetProperty("terminationComponent", out var targetComponent) && targetComponent.ValueKind == JsonValueKind.Object &&
                targetComponent.TryGetProperty("artifactId", out var targetArtifact) && targetArtifact.ValueKind == JsonValueKind.String && targetArtifact.GetString() != artifactId)
                throw Invalid("A contact termination group must reuse its component artifact.", path + ".artifactId");
            var artifactKind = Text(groupArtifact.Value, "kind", groupArtifact.Path);
            if (artifactKind == "terminal") BindTerminalArtifact(artifactId, ContactKey(connectorId, contactId), terminalArtifactTargets, path + ".artifactId");
            else if (artifactKind == "sleeve")
            {
                if (!connector.Value.TryGetProperty("terminationComponent", out var component) || component.ValueKind != JsonValueKind.Object ||
                    !component.TryGetProperty("artifactId", out var componentArtifact) || componentArtifact.ValueKind != JsonValueKind.String || componentArtifact.GetString() != artifactId ||
                    !component.TryGetProperty("kind", out var componentKind) || componentKind.ValueKind != JsonValueKind.String || componentKind.GetString() != "sleeve")
                    throw Invalid("A sleeve group must target one of its sleeve component ports.", path + ".artifactId");
            }
            else throw Invalid("A termination group requires a terminal or sleeve artifact.", path + ".artifactId");
            var members = Required(group.Value, "memberEnds", path);
            if (members.ValueKind != JsonValueKind.Array || members.GetArrayLength() == 0) throw Invalid("A termination group must contain wire ends.", path + ".memberEnds");
            foreach (var member in members.EnumerateArray())
            {
                var key = EndKey(member, path + ".memberEnds");
                if (!usedMembers.Add(key)) throw Invalid("A wire end cannot belong to more than one termination group.", path + ".memberEnds");
                groupArtifactByMember.Add(key, artifactId);
                var endpoint = EndEndpoint(member, wires, path + ".memberEnds");
                if (!MatchesContact(endpoint, connectorId, contactId)) throw Invalid("Every group wire end must terminate at its target contact.", path + ".memberEnds");
            }
        }

        var preparedEnds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (id, preparation) in preparations)
        {
            var path = preparation.Path;
            var mode = Text(preparation.Value, "mode", path);
            if (!PreparationModes.Contains(mode)) throw Invalid("Unknown termination preparation mode.", path + ".mode");
            var key = EndKey(preparation.Value, path);
            if (!preparedEnds.Add(key)) throw Invalid("A wire end can have only one preparation.", path);
            var endpoint = EndEndpoint(preparation.Value, wires, path);
            if (preparation.Value.TryGetProperty("artifactId", out var artifactId))
            {
                var artifact = String(artifactId, path + ".artifactId");
                RequireArtifact(artifact, "terminal", artifacts, path + ".artifactId");
                if (groupArtifactByMember.TryGetValue(key, out var groupArtifactId) && groupArtifactId != artifact)
                    throw Invalid("A prepared wire end must use the same terminal artifact as its termination group.", path + ".artifactId");
                if (endpoint.ValueKind == JsonValueKind.Object && endpoint.TryGetProperty("connectorId", out var connectorId) && connectorId.ValueKind == JsonValueKind.String &&
                    connectors.TryGetValue(connectorId.GetString()!, out var endpointConnector) &&
                    endpointConnector.Value.TryGetProperty("terminationComponent", out var component) && component.ValueKind == JsonValueKind.Object &&
                    component.TryGetProperty("artifactId", out var componentArtifactId) && componentArtifactId.ValueKind == JsonValueKind.String &&
                    componentArtifactId.GetString() != artifact)
                    throw Invalid("A prepared wire end must use the same terminal artifact as its termination component.", path + ".artifactId");
                BindTerminalArtifact(artifact, EndpointIdentity(endpoint, Text(preparation.Value, "wireId", path), Text(preparation.Value, "end", path)), terminalArtifactTargets, path + ".artifactId");
            }
            if (preparation.Value.TryGetProperty("sealArtifactId", out var sealId))
                RequireArtifact(String(sealId, path + ".sealArtifactId"), "seal", artifacts, path + ".sealArtifactId");
            var hasArtifact = preparation.Value.TryGetProperty("artifactId", out _);
            var hasSeal = preparation.Value.TryGetProperty("sealArtifactId", out _);
            if ((mode is "cut" or "copper" or "tin") && (hasArtifact || hasSeal)) throw Invalid("Bare preparation modes cannot reference terminal or seal artifacts.", path);
            if (mode is not ("pin-sealed" or "socket-sealed") && hasSeal) throw Invalid("A seal artifact requires a sealed preparation mode.", path + ".sealArtifactId");
            if (preparation.Value.TryGetProperty("stripLengthMm", out var stripLength) && stripLength.ValueKind != JsonValueKind.Null)
                NonNegativeNumber(stripLength, path + ".stripLengthMm");
        }

        ValidateTwists(design, twists, wires);
        ValidateOperations(operations, groups, twists, connectors, wires);
    }

    private static void ValidateArtifacts(Dictionary<string, (JsonElement Value, string Path)> artifacts)
    {
        foreach (var (id, artifact) in artifacts)
        {
            var path = artifact.Path;
            if (Text(artifact.Value, "id", path) != id) throw Invalid("Invalid termination artifact.", path);
            var kind = Text(artifact.Value, "kind", path);
            if (kind is not ("terminal" or "sleeve" or "seal")) throw Invalid("Unknown termination artifact kind.", path + ".kind");
            _ = Text(artifact.Value, "article", path, allowEmpty: true);
            _ = Text(artifact.Value, "symbolId", path);
            if (artifact.Value.TryGetProperty("capacity", out var capacity))
            {
                RequireObject(capacity, path + ".capacity");
                if (!capacity.TryGetProperty("confirmed", out var confirmed) || confirmed.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    throw Invalid("Termination capacity confirmation must be boolean.", path + ".capacity.confirmed");
                var min = OptionalPositiveInteger(capacity, "minWireCount", path + ".capacity");
                var max = OptionalPositiveInteger(capacity, "maxWireCount", path + ".capacity");
                if (min.HasValue && max.HasValue && min > max) throw Invalid("Termination capacity bounds are reversed.", path + ".capacity");
                if (capacity.TryGetProperty("combinations", out var combinations))
                {
                    if (combinations.ValueKind != JsonValueKind.Array) throw Invalid("Capacity combinations must be an array.", path + ".capacity.combinations");
                    var index = 0;
                    foreach (var combination in combinations.EnumerateArray())
                    {
                        var combinationPath = $"{path}.capacity.combinations[{index++}]";
                        RequireObject(combination, combinationPath);
                        var unit = Text(combination, "unit", combinationPath);
                        if (unit is not ("mm2" or "awg")) throw Invalid("Unknown section unit.", combinationPath + ".unit");
                        var sections = Required(combination, "sections", combinationPath);
                        if (sections.ValueKind != JsonValueKind.Array || sections.GetArrayLength() == 0) throw Invalid("A capacity combination needs sections.", combinationPath + ".sections");
                        foreach (var section in sections.EnumerateArray()) PositiveNumber(section, combinationPath + ".sections");
                        if (combination.TryGetProperty("material", out var material)) _ = String(material, combinationPath + ".material");
                    }
                }
            }
            if (artifact.Value.TryGetProperty("catalogBinding", out var artifactBinding)) ValidateCatalogBinding(artifactBinding, path + ".catalogBinding");
            if (artifact.Value.TryGetProperty("dimensions", out var dimensions))
            {
                RequireObject(dimensions, path + ".dimensions");
                foreach (var property in dimensions.EnumerateObject()) NonNegativeNumber(property.Value, path + ".dimensions." + property.Name);
            }
        }
    }

    private static void ValidateTwists(JsonElement design, Dictionary<string, (JsonElement Value, string Path)> twists,
        Dictionary<string, (JsonElement Value, string Path)> wires)
    {
        var claimedPairs = new HashSet<string>(StringComparer.Ordinal);
        var segments = new HashSet<string>(StringComparer.Ordinal);
        var routes = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        if (design.TryGetProperty("physicalTopology", out var topology) && topology.ValueKind == JsonValueKind.Object)
        {
            if (topology.TryGetProperty("segments", out var segmentArray) && segmentArray.ValueKind == JsonValueKind.Array)
                foreach (var segment in segmentArray.EnumerateArray()) segments.Add(Text(segment, "id", "content.physicalTopology.segments"));
            if (topology.TryGetProperty("routes", out var routeArray) && routeArray.ValueKind == JsonValueKind.Array)
                foreach (var route in routeArray.EnumerateArray())
                {
                    var wireId = Text(route, "wireId", "content.physicalTopology.routes");
                    if (!routes.TryAdd(wireId, new HashSet<string>(StringComparer.Ordinal))) throw Invalid("Duplicate physical route.", "content.physicalTopology.routes");
                    if (route.TryGetProperty("steps", out var steps) && steps.ValueKind == JsonValueKind.Array)
                        foreach (var step in steps.EnumerateArray()) routes[wireId].Add(Text(step, "segmentId", "content.physicalTopology.routes.steps"));
                }
        }
        foreach (var (id, twist) in twists)
        {
            var path = twist.Path;
            if (Text(twist.Value, "id", path) != id) throw Invalid("Invalid twist group.", path);
            var members = StringArray(twist.Value, "memberWireIds", path, minimum: 2);
            var segmentIds = StringArray(twist.Value, "segmentIds", path, minimum: 1);
            if (members.Distinct(StringComparer.Ordinal).Count() != members.Length || segmentIds.Distinct(StringComparer.Ordinal).Count() != segmentIds.Length)
                throw Invalid("Twist members and segments must be unique.", path);
            if (Text(twist.Value, "direction", path) is not ("left" or "right")) throw Invalid("Twist direction must be left or right.", path + ".direction");
            if (twist.Value.TryGetProperty("pitchMm", out var pitch) && pitch.ValueKind != JsonValueKind.Null) PositiveNumber(pitch, path + ".pitchMm");
            if (members.Any(member => !wires.ContainsKey(member))) throw Invalid("Twist group references an unknown wire.", path + ".memberWireIds");
            foreach (var segment in segmentIds)
            {
                if (!segments.Contains(segment) || members.Any(member => !routes.TryGetValue(member, out var route) || !route.Contains(segment)))
                    throw Invalid("Twist members must share each referenced physical segment.", path + ".segmentIds");
                foreach (var member in members)
                    if (!claimedPairs.Add(member + "\u001f" + segment))
                        throw Invalid("A wire segment can belong to only one physical twist group.", path + ".segmentIds");
            }
        }
    }

    private static void ValidateOperations(Dictionary<string, (JsonElement Value, string Path)> operations,
        Dictionary<string, (JsonElement Value, string Path)> groups, Dictionary<string, (JsonElement Value, string Path)> twists,
        Dictionary<string, (JsonElement Value, string Path)> connectors, Dictionary<string, (JsonElement Value, string Path)> wires)
    {
        var dependencies = new Dictionary<string, string[]>(StringComparer.Ordinal);
        foreach (var (id, operation) in operations)
        {
            var path = operation.Path;
            if (Text(operation.Value, "id", path) != id) throw Invalid("Invalid termination operation.", path);
            var kind = Text(operation.Value, "kind", path);
            if (kind is not ("strip" or "tin" or "crimp" or "ultrasonic-weld" or "twist")) throw Invalid("Unknown termination operation kind.", path + ".kind");
            if (!operation.Value.TryGetProperty("executionCount", out var count) || count.ValueKind != JsonValueKind.Null) PositiveInteger(count, path + ".executionCount");
            if (operation.Value.TryGetProperty("processCapacity", out var capacity) && capacity.ValueKind != JsonValueKind.Null) PositiveInteger(capacity, path + ".processCapacity");
            if (operation.Value.TryGetProperty("recipe", out var recipe)) ValidateCatalogBinding(recipe, path + ".recipe");
            if (operation.Value.TryGetProperty("dependsOn", out var deps))
            {
                var values = ParseStringArray(deps, path + ".dependsOn", 0);
                if (values.Distinct(StringComparer.Ordinal).Count() != values.Length) throw Invalid("Duplicate operation dependency.", path + ".dependsOn");
                dependencies[id] = values;
            }
            else dependencies[id] = [];
            if (operation.Value.TryGetProperty("target", out var target)) ValidateOperationTarget(target, path + ".target", groups, twists, connectors, wires);
            else throw Invalid("An operation target is required.", path + ".target");
            if (operation.Value.TryGetProperty("norm", out var norm))
            {
                RequireObject(norm, path + ".norm");
                foreach (var name in new[] { "machineSeconds", "humanSeconds", "setupSeconds" })
                    if (!norm.TryGetProperty(name, out var seconds) || seconds.ValueKind != JsonValueKind.Null) NonNegativeNumber(seconds, path + ".norm." + name);
            }
        }
        foreach (var (id, deps) in dependencies)
            if (deps.Any(dep => !operations.ContainsKey(dep))) throw Invalid("Operation dependency references an unknown operation.", operations[id].Path + ".dependsOn");
        var active = new HashSet<string>(StringComparer.Ordinal);
        var complete = new HashSet<string>(StringComparer.Ordinal);
        void Visit(string id)
        {
            if (active.Contains(id)) throw Invalid("Termination operation dependencies contain a cycle.", operations[id].Path + ".dependsOn");
            if (!complete.Add(id)) return;
            active.Add(id);
            foreach (var dependency in dependencies[id]) Visit(dependency);
            active.Remove(id);
        }
        foreach (var id in operations.Keys) Visit(id);
    }

    private static void ValidateOperationTarget(JsonElement target, string path,
        Dictionary<string, (JsonElement Value, string Path)> groups, Dictionary<string, (JsonElement Value, string Path)> twists,
        Dictionary<string, (JsonElement Value, string Path)> connectors, Dictionary<string, (JsonElement Value, string Path)> wires)
    {
        RequireObject(target, path);
        switch (Text(target, "kind", path))
        {
            case "wireEnd": _ = EndEndpoint(target, wires, path); break;
            case "group": if (!groups.ContainsKey(Text(target, "groupId", path))) throw Invalid("Operation references an unknown termination group.", path + ".groupId"); break;
            case "twist": if (!twists.ContainsKey(Text(target, "twistId", path))) throw Invalid("Operation references an unknown twist group.", path + ".twistId"); break;
            case "portSet":
                var connectorId = Text(target, "connectorId", path);
                if (!connectors.TryGetValue(connectorId, out var connector) ||
                    !connector.Value.TryGetProperty("terminationComponent", out var component) ||
                    component.ValueKind != JsonValueKind.Object ||
                    !component.TryGetProperty("kind", out var componentKind) || componentKind.ValueKind != JsonValueKind.String || componentKind.GetString() != "sleeve")
                    throw Invalid("Port-set operations require a sleeve component.", path);
                var contacts = StringArray(target, "contactIds", path, minimum: 1);
                if (contacts.Distinct(StringComparer.Ordinal).Count() != contacts.Length || contacts.Any(contact => !ContactExists(connector.Value, contact)))
                    throw Invalid("Port-set operation references invalid or duplicate contacts.", path + ".contactIds");
                break;
            default: throw Invalid("Unknown operation target kind.", path + ".kind");
        }
    }

    private static Dictionary<string, (JsonElement Value, string Path)> Index(JsonElement owner, string property, string path)
    {
        var result = new Dictionary<string, (JsonElement Value, string Path)>(StringComparer.Ordinal);
        if (!owner.TryGetProperty(property, out var array))
        {
            if (path == "content.terminations") throw Invalid("Termination document collections are required.", path + "." + property);
            return result;
        }
        if (array.ValueKind != JsonValueKind.Array || array.GetArrayLength() > 10000) throw Invalid("Invalid termination collection.", path + "." + property);
        var index = 0;
        foreach (var item in array.EnumerateArray())
        {
            var itemPath = $"{path}.{property}[{index++}]";
            RequireObject(item, itemPath);
            var id = Text(item, "id", itemPath);
            if (!result.TryAdd(id, (item, itemPath))) throw Invalid("Termination IDs must be unique within each collection.", itemPath + ".id");
        }
        return result;
    }

    private static bool ContactExists(JsonElement connector, string id) => connector.TryGetProperty("contacts", out var contacts) && contacts.ValueKind == JsonValueKind.Array && contacts.EnumerateArray().Any(contact => contact.ValueKind == JsonValueKind.Object && contact.TryGetProperty("id", out var value) && value.ValueKind == JsonValueKind.String && value.GetString() == id);
    private static string ContactKey(string connectorId, string contactId) => "contact:" + connectorId + "\u001f" + contactId;
    private static string EndpointIdentity(JsonElement endpoint, string wireId, string side)
    {
        if (endpoint.ValueKind == JsonValueKind.Object && endpoint.TryGetProperty("connectorId", out var connector) && connector.ValueKind == JsonValueKind.String &&
            endpoint.TryGetProperty("contactId", out var contact) && contact.ValueKind == JsonValueKind.String && !endpoint.TryGetProperty("junctionId", out _) && !endpoint.TryGetProperty("screenId", out _))
            return ContactKey(connector.GetString()!, contact.GetString()!);
        return "wire-end:" + wireId + "\u001f" + side;
    }
    private static void RequireArtifact(string id, string expectedKind, Dictionary<string, (JsonElement Value, string Path)> artifacts, string path)
    {
        if (!artifacts.TryGetValue(id, out var artifact) || Text(artifact.Value, "kind", artifact.Path) != expectedKind)
            throw Invalid("Termination artifact is missing or has the wrong kind.", path);
    }
    private static void BindTerminalArtifact(string artifactId, string identity, Dictionary<string, string> targets, string path)
    {
        if (targets.TryGetValue(artifactId, out var existing) && existing != identity)
            throw Invalid("A terminal artifact can belong to only one contact or free wire end.", path);
        targets[artifactId] = identity;
    }
    private static bool IsDisconnected(JsonElement connector, string id) => connector.GetProperty("contacts").EnumerateArray().Any(contact => contact.TryGetProperty("id", out var value) && value.GetString() == id && contact.TryGetProperty("connectionStatus", out var status) && status.ValueKind == JsonValueKind.String && status.GetString() == "not-connected");
    private static bool MatchesContact(JsonElement endpoint, string connectorId, string contactId) => endpoint.ValueKind == JsonValueKind.Object && !endpoint.TryGetProperty("junctionId", out _) && !endpoint.TryGetProperty("screenId", out _) && endpoint.TryGetProperty("connectorId", out var connector) && connector.ValueKind == JsonValueKind.String && connector.GetString() == connectorId && endpoint.TryGetProperty("contactId", out var contact) && contact.ValueKind == JsonValueKind.String && contact.GetString() == contactId;
    private static JsonElement EndEndpoint(JsonElement end, Dictionary<string, (JsonElement Value, string Path)> wires, string path)
    {
        var wireId = Text(end, "wireId", path); var side = Text(end, "end", path);
        if (side is not ("from" or "to")) throw Invalid("Wire end must be from or to.", path + ".end");
        if (!wires.TryGetValue(wireId, out var wire)) throw Invalid("Wire end references an unknown wire.", path + ".wireId");
        if (!wire.Value.TryGetProperty(side, out var endpoint)) throw Invalid("Referenced wire end is missing.", wire.Path + "." + side);
        return endpoint;
    }
    private static string EndKey(JsonElement end, string path) => Text(end, "wireId", path) + "\u001f" + Text(end, "end", path);
    private static string[] StringArray(JsonElement owner, string property, string path, int minimum) => ParseStringArray(Required(owner, property, path), path + "." + property, minimum);
    private static string[] ParseStringArray(JsonElement array, string path, int minimum)
    {
        if (array.ValueKind != JsonValueKind.Array || array.GetArrayLength() < minimum || array.GetArrayLength() > 10000) throw Invalid("Invalid reference list.", path);
        return array.EnumerateArray().Select(item => String(item, path)).ToArray();
    }
    private static int? OptionalPositiveInteger(JsonElement owner, string property, string path)
    {
        if (!owner.TryGetProperty(property, out var value)) return null;
        PositiveInteger(value, path + "." + property);
        return value.GetInt32();
    }
    private static void PositiveInteger(JsonElement value, string path)
    { if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number) || number <= 0 || number > 1_000_000_000) throw Invalid("Expected a positive integer.", path); }
    private static void PositiveNumber(JsonElement value, string path)
    { var number = NonNegativeNumber(value, path); if (number <= 0) throw Invalid("Expected a positive number.", path); }
    private static double NonNegativeNumber(JsonElement value, string path)
    { if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number) || number < 0 || number > 1e9) throw Invalid("Expected a finite non-negative number.", path); return number; }
    private static JsonElement Required(JsonElement owner, string property, string path) => owner.TryGetProperty(property, out var value) ? value : throw Invalid("Required termination field is missing.", path + "." + property);
    private static void RequireObject(JsonElement value, string path) { if (value.ValueKind != JsonValueKind.Object) throw Invalid("Expected an object.", path); }
    private static void ValidateCatalogBinding(JsonElement value, string path)
    {
        RequireObject(value, path);
        foreach (var property in new[] { "sourceId", "snapshotId", "snapshotSha256", "recordId", "sourceKey", "displayName" }) _ = Text(value, property, path);
        if (value.TryGetProperty("payload", out var payload)) RequireObject(payload, path + ".payload");
    }
    private static string Text(JsonElement owner, string property, string path, bool allowEmpty = false) => String(Required(owner, property, path), path + "." + property, allowEmpty);
    private static string String(JsonElement value, string path, bool allowEmpty = false)
    { if (value.ValueKind != JsonValueKind.String || value.GetString() is not { Length: <= 1024 } text || (!allowEmpty && string.IsNullOrWhiteSpace(text))) throw Invalid("Expected text.", path); return text; }
    private static HarnessDesignDocumentException Invalid(string message, string field) => new("invalid_harness_termination", message, field);
}
