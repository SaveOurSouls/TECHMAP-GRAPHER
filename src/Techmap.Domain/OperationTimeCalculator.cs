using System.Numerics;

namespace Techmap.Domain;

public sealed record LinearOperationTimeInput(
    Length? MaterialLength,
    ExactDuration? FeedTimePerMetre,
    ExactDuration? ToolActionTime,
    long? ToolActionCount,
    ExactDuration? AdditionalOperationTime,
    ExactDuration? ManualWorkTime,
    ExactDuration? RemoveWorkpieceTime,
    ExactDuration? TakeWorkpieceTime,
    long? RepetitionsPerWorkpiece,
    long? WorkpieceCount);

public sealed record StaticOperationTimeInput(
    ExactDuration? ToolActionTime,
    long? ToolActionCount,
    ExactDuration? AdditionalOperationTime,
    ExactDuration? ManualWorkTime,
    ExactDuration? RemoveWorkpieceTime,
    ExactDuration? TakeWorkpieceTime,
    long? RepetitionsPerWorkpiece,
    long? WorkpieceCount);

public sealed record OperationTimeResult(
    ExactDuration? MachineTime,
    ExactDuration? PersonTime,
    ExactDuration? OperationTime,
    ExactDuration? TimePerWorkpiece,
    ExactDuration? Labour)
{
    public bool HasCompleteOperationTime => OperationTime is not null;

    public bool HasCompleteLabour => Labour is not null;
}

public static class OperationTimeCalculator
{
    public static OperationTimeResult Calculate(LinearOperationTimeInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var factors = new OperationFactors(
            input.ToolActionTime,
            input.ToolActionCount,
            input.AdditionalOperationTime,
            input.ManualWorkTime,
            input.RemoveWorkpieceTime,
            input.TakeWorkpieceTime,
            input.RepetitionsPerWorkpiece,
            input.WorkpieceCount);
        ValidateFactors(factors);

        var machineTime = CalculateLinearMachineTime(
            input.MaterialLength,
            input.FeedTimePerMetre,
            factors);
        return Complete(machineTime, factors);
    }

    public static OperationTimeResult Calculate(StaticOperationTimeInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var factors = new OperationFactors(
            input.ToolActionTime,
            input.ToolActionCount,
            input.AdditionalOperationTime,
            input.ManualWorkTime,
            input.RemoveWorkpieceTime,
            input.TakeWorkpieceTime,
            input.RepetitionsPerWorkpiece,
            input.WorkpieceCount);
        ValidateFactors(factors);

        return Complete(CalculateStaticMachineTime(factors), factors);
    }

    private static OperationTimeResult Complete(
        ExactDuration? machineTime,
        OperationFactors factors)
    {
        var personTime = CalculatePersonTime(factors);
        var operationTime = Maximum(machineTime, personTime);
        var timePerWorkpiece = Multiply(
            operationTime,
            factors.RepetitionsPerWorkpiece,
            "The repeated operation time exceeds the supported range.");
        var labour = Multiply(
            timePerWorkpiece,
            factors.WorkpieceCount,
            "The operation labour exceeds the supported range.");

        return new OperationTimeResult(
            machineTime,
            personTime,
            operationTime,
            timePerWorkpiece,
            labour);
    }

    private static ExactDuration? CalculateLinearMachineTime(
        Length? materialLength,
        ExactDuration? feedTimePerMetre,
        OperationFactors factors)
    {
        var staticTime = CalculateStaticMachineTime(factors);
        if (materialLength is null || feedTimePerMetre is null || staticTime is null)
        {
            return null;
        }

        var numerator =
            (BigInteger)materialLength.Value.Micrometres * feedTimePerMetre.Value.Microseconds;
        var feedMicroseconds = BigInteger.DivRem(
            numerator,
            Length.MicrometresPerMetre,
            out var remainder);

        if (!remainder.IsZero)
        {
            throw new ArgumentException(
                "The linear feed time cannot be represented as a whole number of microseconds.");
        }

        return ToDuration(
            feedMicroseconds + staticTime.Value.Microseconds,
            "The machine time exceeds the supported range.");
    }

    private static ExactDuration? CalculateStaticMachineTime(OperationFactors factors)
    {
        if (
            factors.ToolActionTime is null ||
            factors.ToolActionCount is null ||
            factors.AdditionalOperationTime is null)
        {
            return null;
        }

        var machineMicroseconds =
            (BigInteger)factors.ToolActionTime.Value.Microseconds * factors.ToolActionCount.Value +
            factors.AdditionalOperationTime.Value.Microseconds;
        return ToDuration(machineMicroseconds, "The machine time exceeds the supported range.");
    }

    private static ExactDuration? CalculatePersonTime(OperationFactors factors)
    {
        if (
            factors.AdditionalOperationTime is null ||
            factors.ManualWorkTime is null ||
            factors.RemoveWorkpieceTime is null ||
            factors.TakeWorkpieceTime is null)
        {
            return null;
        }

        BigInteger personMicroseconds = factors.AdditionalOperationTime.Value.Microseconds;
        personMicroseconds += factors.ManualWorkTime.Value.Microseconds;
        personMicroseconds += factors.RemoveWorkpieceTime.Value.Microseconds;
        personMicroseconds += factors.TakeWorkpieceTime.Value.Microseconds;
        return ToDuration(personMicroseconds, "The person time exceeds the supported range.");
    }

    private static ExactDuration? Maximum(ExactDuration? left, ExactDuration? right)
    {
        if (left is null || right is null)
        {
            return null;
        }

        return left.Value.Microseconds >= right.Value.Microseconds ? left : right;
    }

    private static ExactDuration? Multiply(
        ExactDuration? duration,
        long? multiplier,
        string overflowMessage)
    {
        if (duration is null || multiplier is null)
        {
            return null;
        }

        return ToDuration(
            (BigInteger)duration.Value.Microseconds * multiplier.Value,
            overflowMessage);
    }

    private static ExactDuration ToDuration(BigInteger microseconds, string overflowMessage)
    {
        if (microseconds > long.MaxValue)
        {
            throw new OverflowException(overflowMessage);
        }

        return new ExactDuration((long)microseconds);
    }

    private static void ValidateCount(long? value, string parameterName, bool allowZero)
    {
        if (value < 0 || (!allowZero && value == 0))
        {
            throw new ArgumentOutOfRangeException(
                parameterName,
                allowZero ? "A count must not be negative." : "A repetition count must be positive.");
        }
    }

    private static void ValidateFactors(OperationFactors factors)
    {
        ValidateCount(factors.ToolActionCount, nameof(factors.ToolActionCount), allowZero: true);
        ValidateCount(
            factors.RepetitionsPerWorkpiece,
            nameof(factors.RepetitionsPerWorkpiece),
            allowZero: false);
        ValidateCount(factors.WorkpieceCount, nameof(factors.WorkpieceCount), allowZero: true);
    }

    private sealed record OperationFactors(
        ExactDuration? ToolActionTime,
        long? ToolActionCount,
        ExactDuration? AdditionalOperationTime,
        ExactDuration? ManualWorkTime,
        ExactDuration? RemoveWorkpieceTime,
        ExactDuration? TakeWorkpieceTime,
        long? RepetitionsPerWorkpiece,
        long? WorkpieceCount);
}
