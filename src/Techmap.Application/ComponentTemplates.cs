namespace Techmap.Application;

public sealed record ComponentTemplateArticleBinding(
    string SourceId,
    string EntityType,
    string ArticleKey);

public sealed record ComponentTemplateAsset(
    Guid AssetId,
    AttachmentContent Content,
    string FileName,
    string MediaType);

public sealed record ComponentTemplateSummary(
    Guid TemplateId,
    int Version,
    string Code,
    string Name,
    IReadOnlyList<ComponentTemplateArticleBinding> ArticleBindings,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ComponentTemplateVersion(
    Guid TemplateId,
    int Version,
    string Code,
    string Name,
    IReadOnlyList<ComponentTemplateArticleBinding> ArticleBindings,
    IReadOnlyList<ComponentTemplateAsset> Assets,
    int SchemaVersion,
    string ContentJson,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public interface IComponentTemplateStore
{
    IReadOnlyList<ComponentTemplateSummary> List();

    ComponentTemplateVersion Get(Guid templateId);

    IReadOnlyList<ComponentTemplateVersion> ListVersions(Guid templateId);

    ComponentTemplateVersion GetVersion(Guid templateId, int version);

    ComponentTemplateVersion Create(
        string code,
        string name,
        IReadOnlyCollection<ComponentTemplateArticleBinding> articleBindings,
        int schemaVersion,
        string contentJson);

    ComponentTemplateVersion Update(
        Guid templateId,
        int expectedVersion,
        string code,
        string name,
        IReadOnlyCollection<ComponentTemplateArticleBinding> articleBindings,
        int schemaVersion,
        string contentJson);

    Task<ComponentTemplateVersion> AddAssetAsync(
        Guid templateId,
        int expectedVersion,
        Stream source,
        string fileName,
        string mediaType,
        CancellationToken cancellationToken = default);

    ComponentTemplateVersion RemoveAsset(
        Guid templateId,
        int expectedVersion,
        Guid assetId);

    Task<Stream> OpenAssetAsync(
        Guid templateId,
        int version,
        Guid assetId,
        CancellationToken cancellationToken = default);

    void Delete(Guid templateId, int expectedVersion);
}

public sealed class ComponentTemplateException : Exception
{
    public ComponentTemplateException(
        string code,
        string message,
        string? field = null,
        int? currentVersion = null,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        Field = field;
        CurrentVersion = currentVersion;
    }

    public string Code { get; }

    public string? Field { get; }

    public int? CurrentVersion { get; }
}
