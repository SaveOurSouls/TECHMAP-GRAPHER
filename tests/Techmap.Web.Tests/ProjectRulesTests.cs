using Techmap.Domain;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectRulesTests
{
    [Fact]
    public void Project_text_is_trimmed_and_preserves_cyrillic()
    {
        Assert.Equal(
            "Шкаф управления — 01",
            ProjectRules.NormalizeDesignation("  Шкаф управления — 01  ", "designation"));
        Assert.Equal(
            "Жгут силовой",
            ProjectRules.NormalizeName("\tЖгут силовой\r\n", "name"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("bad\u0000value")]
    [InlineData("bad\u001Fvalue")]
    public void Invalid_project_text_is_rejected(string value)
    {
        Assert.Throws<ArgumentException>(() =>
            ProjectRules.NormalizeDesignation(value, "designation"));
    }

    [Fact]
    public void Project_text_length_limits_are_enforced()
    {
        Assert.Equal(
            ProjectRules.MaximumDesignationLength,
            ProjectRules.NormalizeDesignation(
                new string('D', ProjectRules.MaximumDesignationLength),
                "designation").Length);
        Assert.Throws<ArgumentException>(() =>
            ProjectRules.NormalizeDesignation(
                new string('D', ProjectRules.MaximumDesignationLength + 1),
                "designation"));

        Assert.Equal(
            ProjectRules.MaximumNameLength,
            ProjectRules.NormalizeName(new string('N', ProjectRules.MaximumNameLength), "name").Length);
        Assert.Throws<ArgumentException>(() =>
            ProjectRules.NormalizeName(new string('N', ProjectRules.MaximumNameLength + 1), "name"));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(long.MinValue)]
    public void Batch_quantity_must_be_positive(long value)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            ProjectRules.ValidateBatchQuantity(value, "batchQuantity"));
    }

    [Theory]
    [InlineData(ProjectStatus.Draft, "draft")]
    [InlineData(ProjectStatus.Active, "active")]
    [InlineData(ProjectStatus.Completed, "completed")]
    public void Project_status_has_a_stable_external_code(ProjectStatus status, string code)
    {
        Assert.Equal(code, ProjectRules.ToCode(status));
        Assert.True(ProjectRules.TryParseStatus(code, out var parsed));
        Assert.Equal(status, parsed);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ACTIVE")]
    [InlineData("archived")]
    public void Unknown_project_status_is_rejected(string? code)
    {
        Assert.False(ProjectRules.TryParseStatus(code, out _));
    }
}
