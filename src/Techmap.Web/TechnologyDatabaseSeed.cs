using System.Security.Cryptography;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Xlsx;

namespace Techmap.Web;

/// <summary>Seeds supported technology catalogs from the bundled source workbook.</summary>
public static class TechnologyDatabaseSeed
{
    private const string ResourceName = "Techmap.Web.TechnologyDatabaseArchive.xlsx";
    private const string FileName = "technology-database-2026-10-03.xlsx";
    private const string ExpectedSha256 = "4762850819e390f01c9da781581511bd71c5224fef275311409eed10ca65e546";
    private static readonly Lazy<Task<IReadOnlyDictionary<string, ReferenceCatalogValidationResult>>> Validations =
        new(LoadAndValidateAsync);

    public static async Task EnsurePublishedAsync(IReferenceCatalogSnapshotStore store, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        var pending = XlsxKnownProfiles.All
            .Where(profile => profile.Id != "technology.wires" && store.GetActive(profile.SourceId) is null)
            .ToArray();
        if (pending.Length == 0) return;

        var validations = await Validations.Value.WaitAsync(cancellationToken).ConfigureAwait(false);
        foreach (var profile in pending)
        {
            var validation = validations[profile.SourceId];
            var publication = new ReferenceCatalogPublicationService(store).Publish(
                new ReferenceCatalogPublicationRequest(validation, null,
                    validation.Snapshot!.Sha256, validation.RequiredWarningAcknowledgements));
            if (publication.Status is not (ReferenceCatalogPublicationStatus.Published or ReferenceCatalogPublicationStatus.Unchanged) &&
                store.GetActive(profile.SourceId) is null)
                throw new InvalidDataException($"The bundled technology catalog {profile.Id} could not be published.");
        }
    }

    private static async Task<IReadOnlyDictionary<string, ReferenceCatalogValidationResult>> LoadAndValidateAsync()
    {
        await using var resource = typeof(TechnologyDatabaseSeed).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidDataException("The bundled technology database is missing.");
        using var buffer = new MemoryStream();
        await resource.CopyToAsync(buffer).ConfigureAwait(false);
        var content = buffer.ToArray();
        if (content.Length is < 1 or > XlsxReferenceCatalogReader.MaximumInputBytes)
            throw new InvalidDataException("The bundled technology database has an invalid size.");
        if (!string.Equals(Convert.ToHexStringLower(SHA256.HashData(content)), ExpectedSha256, StringComparison.Ordinal))
            throw new InvalidDataException("The bundled technology database has an unexpected SHA-256.");

        var validations = new Dictionary<string, ReferenceCatalogValidationResult>(StringComparer.Ordinal);
        foreach (var profile in XlsxKnownProfiles.All.Where(profile => profile.Id != "technology.wires"))
        {
            var preview = await new XlsxReferenceCatalogReader().PreviewAsync(
                new MemoryStream(content, writable: false), FileName, profile.SourceId,
                profile.Mapping, ReferenceCatalogSnapshotIdentity.New(), DateTimeOffset.UtcNow,
                CancellationToken.None).ConfigureAwait(false);
            if (!preview.Validation.IsValid || preview.Validation.Snapshot is null)
                throw new InvalidDataException($"The bundled technology catalog {profile.Id} failed validation: " +
                    string.Join("; ", preview.Validation.Diagnostics
                        .Where(diagnostic => diagnostic.Severity == ReferenceCatalogDiagnosticSeverity.Error)
                        .Take(5).Select(diagnostic => $"{diagnostic.Code} {diagnostic.SourceLocation}")));

            validations.Add(profile.SourceId, preview.Validation);
        }
        return validations;
    }
}
