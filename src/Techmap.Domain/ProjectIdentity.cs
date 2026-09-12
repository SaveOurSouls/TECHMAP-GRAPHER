namespace Techmap.Domain;

public readonly record struct ProjectIdentity(Guid Value)
{
    public static ProjectIdentity New() => new(Guid.NewGuid());
}

public readonly record struct HarnessIdentity(Guid Value)
{
    public static HarnessIdentity New() => new(Guid.NewGuid());
}
