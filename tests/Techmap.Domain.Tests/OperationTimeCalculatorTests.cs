using Techmap.Domain;
using Xunit;

namespace Techmap.Domain.Tests;

public sealed class OperationTimeCalculatorTests
{
    [Fact]
    public void Ex02_calculates_machine_person_operation_and_batch_labour()
    {
        var result = OperationTimeCalculator.Calculate(new LinearOperationTimeInput(
            MaterialLength: Length.FromMillimetres(20),
            FeedTimePerMetre: Seconds(5),
            ToolActionTime: Seconds(2),
            ToolActionCount: 2,
            AdditionalOperationTime: Seconds(1),
            ManualWorkTime: Seconds(3),
            RemoveWorkpieceTime: Seconds(1),
            TakeWorkpieceTime: Seconds(2),
            RepetitionsPerWorkpiece: 1,
            WorkpieceCount: 100));

        Assert.Equal(5.1m, result.MachineTime!.Value.Seconds);
        Assert.Equal(7m, result.PersonTime!.Value.Seconds);
        Assert.Equal(7m, result.OperationTime!.Value.Seconds);
        Assert.Equal(7m, result.TimePerWorkpiece!.Value.Seconds);
        Assert.Equal(700m, result.Labour!.Value.Seconds);
        Assert.True(result.HasCompleteOperationTime);
        Assert.True(result.HasCompleteLabour);
    }

    [Fact]
    public void Machine_time_determines_operation_time_when_it_exceeds_person_time()
    {
        var result = OperationTimeCalculator.Calculate(StaticInput(
            toolActionTime: 10,
            toolActionCount: 1,
            additionalTime: 1,
            manualTime: 2,
            removeTime: 1,
            takeTime: 1));

        Assert.Equal(11m, result.MachineTime!.Value.Seconds);
        Assert.Equal(5m, result.PersonTime!.Value.Seconds);
        Assert.Equal(11m, result.OperationTime!.Value.Seconds);
    }

    [Fact]
    public void Static_operation_has_no_length_or_feed_inputs()
    {
        var input = StaticInput(
            toolActionTime: 2,
            toolActionCount: 2,
            additionalTime: 1,
            manualTime: 3,
            removeTime: 1,
            takeTime: 2);

        var result = OperationTimeCalculator.Calculate(input);

        Assert.DoesNotContain(
            typeof(StaticOperationTimeInput).GetProperties(),
            property => property.Name.Contains("Length", StringComparison.Ordinal) ||
                property.Name.Contains("Feed", StringComparison.Ordinal));
        Assert.Equal(5m, result.MachineTime!.Value.Seconds);
    }

    [Fact]
    public void Tool_actions_repetitions_and_workpieces_are_each_applied_once()
    {
        var result = OperationTimeCalculator.Calculate(StaticInput(
            toolActionTime: 2,
            toolActionCount: 3,
            additionalTime: 1,
            manualTime: 0,
            removeTime: 0,
            takeTime: 0,
            repetitions: 4,
            workpieces: 5));

        Assert.Equal(7m, result.MachineTime!.Value.Seconds);
        Assert.Equal(1m, result.PersonTime!.Value.Seconds);
        Assert.Equal(7m, result.OperationTime!.Value.Seconds);
        Assert.Equal(28m, result.TimePerWorkpiece!.Value.Seconds);
        Assert.Equal(140m, result.Labour!.Value.Seconds);
    }

    [Fact]
    public void Missing_values_are_incomplete_while_explicit_zero_has_zero_cost()
    {
        var missing = OperationTimeCalculator.Calculate(StaticInput(
            toolActionTime: 0,
            toolActionCount: 0,
            additionalTime: 0,
            manualTime: 0,
            removeTime: 0,
            takeTime: 0) with
        {
            ToolActionTime = null,
            ManualWorkTime = null,
        });

        Assert.Null(missing.MachineTime);
        Assert.Null(missing.PersonTime);
        Assert.Null(missing.OperationTime);
        Assert.Null(missing.TimePerWorkpiece);
        Assert.Null(missing.Labour);
        Assert.False(missing.HasCompleteOperationTime);
        Assert.False(missing.HasCompleteLabour);

        var zero = OperationTimeCalculator.Calculate(StaticInput(
            toolActionTime: 0,
            toolActionCount: 0,
            additionalTime: 0,
            manualTime: 0,
            removeTime: 0,
            takeTime: 0,
            repetitions: 1,
            workpieces: 0));

        Assert.Equal(0, zero.MachineTime!.Value.Microseconds);
        Assert.Equal(0, zero.PersonTime!.Value.Microseconds);
        Assert.Equal(0, zero.OperationTime!.Value.Microseconds);
        Assert.Equal(0, zero.TimePerWorkpiece!.Value.Microseconds);
        Assert.Equal(0, zero.Labour!.Value.Microseconds);
        Assert.True(zero.HasCompleteLabour);
    }

    [Fact]
    public void Known_component_remains_visible_when_the_other_side_is_incomplete()
    {
        var result = OperationTimeCalculator.Calculate(StaticInput(
            toolActionTime: 2,
            toolActionCount: 2,
            additionalTime: 1,
            manualTime: 3,
            removeTime: 1,
            takeTime: 2,
            workpieces: 10) with
        {
            ManualWorkTime = null,
        });

        Assert.Equal(5m, result.MachineTime!.Value.Seconds);
        Assert.Null(result.PersonTime);
        Assert.Null(result.OperationTime);
        Assert.Null(result.Labour);
    }

    [Fact]
    public void Missing_linear_length_or_rate_keeps_final_time_incomplete()
    {
        var input = new LinearOperationTimeInput(
            MaterialLength: null,
            FeedTimePerMetre: Seconds(5),
            ToolActionTime: Seconds(2),
            ToolActionCount: 2,
            AdditionalOperationTime: Seconds(1),
            ManualWorkTime: Seconds(3),
            RemoveWorkpieceTime: Seconds(1),
            TakeWorkpieceTime: Seconds(2),
            RepetitionsPerWorkpiece: 1,
            WorkpieceCount: 100);

        var missingLength = OperationTimeCalculator.Calculate(input);
        var missingRate = OperationTimeCalculator.Calculate(input with
        {
            MaterialLength = Length.FromMillimetres(20),
            FeedTimePerMetre = null,
        });

        Assert.Null(missingLength.MachineTime);
        Assert.Equal(7m, missingLength.PersonTime!.Value.Seconds);
        Assert.Null(missingLength.OperationTime);
        Assert.Null(missingRate.MachineTime);
        Assert.Equal(7m, missingRate.PersonTime!.Value.Seconds);
        Assert.Null(missingRate.OperationTime);
    }

    [Fact]
    public void Linear_feed_must_be_exactly_representable_in_microseconds()
    {
        var input = new LinearOperationTimeInput(
            MaterialLength: new Length(1),
            FeedTimePerMetre: new ExactDuration(1),
            ToolActionTime: Seconds(0),
            ToolActionCount: 0,
            AdditionalOperationTime: Seconds(0),
            ManualWorkTime: Seconds(0),
            RemoveWorkpieceTime: Seconds(0),
            TakeWorkpieceTime: Seconds(0),
            RepetitionsPerWorkpiece: 1,
            WorkpieceCount: 1);

        Assert.Throws<ArgumentException>(() => OperationTimeCalculator.Calculate(input));
    }

    [Fact]
    public void Invalid_counts_and_overflow_are_rejected()
    {
        var input = StaticInput(
            toolActionTime: 1,
            toolActionCount: 1,
            additionalTime: 0,
            manualTime: 0,
            removeTime: 0,
            takeTime: 0);

        Assert.Throws<ArgumentOutOfRangeException>(() => OperationTimeCalculator.Calculate(input with
        {
            ToolActionCount = -1,
        }));
        Assert.Throws<ArgumentOutOfRangeException>(() => OperationTimeCalculator.Calculate(input with
        {
            RepetitionsPerWorkpiece = 0,
        }));
        Assert.Throws<ArgumentOutOfRangeException>(() => OperationTimeCalculator.Calculate(input with
        {
            WorkpieceCount = -1,
        }));
        Assert.Throws<OverflowException>(() => OperationTimeCalculator.Calculate(input with
        {
            ToolActionTime = new ExactDuration(long.MaxValue),
            ToolActionCount = 2,
        }));
        Assert.Throws<OverflowException>(() => OperationTimeCalculator.Calculate(input with
        {
            RepetitionsPerWorkpiece = long.MaxValue,
        }));
    }

    [Fact]
    public void Overflow_is_rejected_in_person_linear_and_batch_totals()
    {
        var staticInput = StaticInput(
            toolActionTime: 0,
            toolActionCount: 0,
            additionalTime: 0,
            manualTime: 0,
            removeTime: 0,
            takeTime: 0);

        Assert.Throws<OverflowException>(() => OperationTimeCalculator.Calculate(staticInput with
        {
            AdditionalOperationTime = new ExactDuration(long.MaxValue),
            ManualWorkTime = new ExactDuration(1),
        }));
        Assert.Throws<OverflowException>(() => OperationTimeCalculator.Calculate(
            new LinearOperationTimeInput(
                new Length(Length.MicrometresPerMetre),
                new ExactDuration(long.MaxValue),
                new ExactDuration(0),
                0,
                new ExactDuration(1),
                new ExactDuration(0),
                new ExactDuration(0),
                new ExactDuration(0),
                1,
                1)));
        Assert.Throws<OverflowException>(() => OperationTimeCalculator.Calculate(staticInput with
        {
            ToolActionTime = new ExactDuration(2),
            ToolActionCount = 1,
            WorkpieceCount = long.MaxValue,
        }));
    }

    [Fact]
    public void Linear_zero_is_complete_and_distinct_from_missing_length()
    {
        var input = new LinearOperationTimeInput(
            MaterialLength: new Length(0),
            FeedTimePerMetre: new ExactDuration(0),
            ToolActionTime: new ExactDuration(0),
            ToolActionCount: 0,
            AdditionalOperationTime: new ExactDuration(0),
            ManualWorkTime: new ExactDuration(0),
            RemoveWorkpieceTime: new ExactDuration(0),
            TakeWorkpieceTime: new ExactDuration(0),
            RepetitionsPerWorkpiece: 1,
            WorkpieceCount: 1);

        var zero = OperationTimeCalculator.Calculate(input);
        var missing = OperationTimeCalculator.Calculate(input with { MaterialLength = null });

        Assert.Equal(0, zero.MachineTime!.Value.Microseconds);
        Assert.Equal(0, zero.Labour!.Value.Microseconds);
        Assert.Null(missing.MachineTime);
        Assert.Null(missing.OperationTime);
    }

    [Fact]
    public void Null_repetition_or_workpiece_count_only_blocks_derived_totals()
    {
        var input = StaticInput(
            toolActionTime: 2,
            toolActionCount: 1,
            additionalTime: 0,
            manualTime: 0,
            removeTime: 0,
            takeTime: 0);

        var missingRepetitions = OperationTimeCalculator.Calculate(input with
        {
            RepetitionsPerWorkpiece = null,
        });
        var missingWorkpieces = OperationTimeCalculator.Calculate(input with
        {
            WorkpieceCount = null,
        });

        Assert.Equal(2m, missingRepetitions.OperationTime!.Value.Seconds);
        Assert.Null(missingRepetitions.TimePerWorkpiece);
        Assert.Null(missingRepetitions.Labour);
        Assert.Equal(2m, missingWorkpieces.TimePerWorkpiece!.Value.Seconds);
        Assert.Null(missingWorkpieces.Labour);
    }

    private static StaticOperationTimeInput StaticInput(
        decimal toolActionTime,
        long toolActionCount,
        decimal additionalTime,
        decimal manualTime,
        decimal removeTime,
        decimal takeTime,
        long repetitions = 1,
        long workpieces = 1) =>
        new(
            ToolActionTime: Seconds(toolActionTime),
            ToolActionCount: toolActionCount,
            AdditionalOperationTime: Seconds(additionalTime),
            ManualWorkTime: Seconds(manualTime),
            RemoveWorkpieceTime: Seconds(removeTime),
            TakeWorkpieceTime: Seconds(takeTime),
            RepetitionsPerWorkpiece: repetitions,
            WorkpieceCount: workpieces);

    private static ExactDuration Seconds(decimal value) => ExactDuration.FromSeconds(value);
}
