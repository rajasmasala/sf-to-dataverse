using System;
using System.Globalization;
using Microsoft.Xrm.Sdk;

namespace UniversalFabric.Plugins;

/// <summary>
///     Dataverse pre-operation plugin for the <c>account</c> <c>Update</c> message.
///     Whenever an update touches <c>crfe6_salesforceid</c> or <c>crfe6_uen</c>,
///     the plugin stamps the inbound <c>Target</c> <see cref="Entity" /> with:
///     <list type="bullet">
///         <item><c>crfe6_lastmodifiedbyintegration_at</c> = current UTC time</item>
///         <item><c>crfe6_sync_notes</c> = "Updated via Plugin at &lt;UTC ISO 8601&gt;"</item>
///     </list>
///     Mutating the Target in a pre-operation stage lets the platform persist the
///     new values in the same Update SQL — no separate Update call, no infinite
///     plugin re-entry.
/// </summary>
/// <remarks>
///     Registration (see plugins/README.md):
///     <list type="bullet">
///         <item><c>Message</c>: Update</item>
///         <item><c>PrimaryEntity</c>: account</item>
///         <item><c>EventPipelineStage</c>: PreOperation (20)</item>
///         <item><c>ExecutionMode</c>: Synchronous (0)</item>
///         <item><c>FilteringAttributes</c>: crfe6_salesforceid, crfe6_uen</item>
///     </list>
/// </remarks>
public sealed class AccountUpdateStampPlugin : IPlugin
{
    /// <summary>
    ///     Logical names of the Account attributes that should trigger the stamp.
    ///     Mirrors the <c>FilteringAttributes</c> registration so the runtime
    ///     behaviour matches the documented registration.
    /// </summary>
    public static readonly string[] TriggerAttributes =
    {
        AccountFields.SalesforceId,
        AccountFields.Uen
    };

    private readonly ISystemClock _clock;

    /// <summary>
    ///     Default constructor used by the Dataverse plugin runtime. Uses
    ///     <see cref="UtcSystemClock" /> so production builds stamp real UTC time.
    /// </summary>
    public AccountUpdateStampPlugin()
        : this(UtcSystemClock.Instance)
    {
    }

    /// <summary>
    ///     Internal constructor that lets unit tests inject a deterministic clock
    ///     so assertions can compare exact timestamps.
    /// </summary>
    internal AccountUpdateStampPlugin(ISystemClock clock)
    {
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
    }

    /// <inheritdoc />
    public void Execute(IServiceProvider serviceProvider)
    {
        if (serviceProvider is null)
        {
            throw new ArgumentNullException(nameof(serviceProvider));
        }

        var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext))
                      ?? throw new InvalidPluginExecutionException("IPluginExecutionContext was not available on the ServiceProvider.");

        if (context.Stage != (int)PipelineStage.PreOperation)
        {
            // Defensive: misregistration should fail loudly rather than silently
            // doing nothing. The README pins the expected stage.
            throw new InvalidPluginExecutionException(
                string.Format(
                    CultureInfo.InvariantCulture,
                    "AccountUpdateStampPlugin must be registered on PreOperation (stage 20). Actual stage was {0}.",
                    context.Stage));
        }

        if (!context.InputParameters.Contains(SdkConstants.Target) ||
            context.InputParameters[SdkConstants.Target] is not Entity target)
        {
            // No Target means there is nothing to mutate (e.g. a specialorganisation
            // request). Nothing to do — and we do not throw so unrelated flows keep working.
            return;
        }

        if (!ShouldStamp(target))
        {
            return;
        }

        StampTarget(target, _clock.UtcNow);
    }

    /// <summary>
    ///     Returns <see langword="true" /> when the inbound Target contains at
    ///     least one of the trigger attributes. Dataverse only populates the
    ///     Target with attributes the caller actually changed, so checking
    ///     <see cref="Entity.Attributes" /> keys is sufficient — no need to
    ///     diff against the PreEntityImage.
    /// </summary>
    internal static bool ShouldStamp(Entity target)
    {
        if (target is null)
        {
            return false;
        }

        foreach (var attr in TriggerAttributes)
        {
            if (target.Contains(attr))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    ///     Mutates the inbound Target with the timestamp + audit note. Split out
    ///     so unit tests can assert on the resulting attribute values without
    ///     spinning up the full Dataverse pipeline.
    /// </summary>
    internal static void StampTarget(Entity target, DateTime utcNow)
    {
        target[AccountFields.LastModifiedByIntegrationAt] = utcNow;
        target[AccountFields.SyncNotes] = Formatters.FormatSyncNote(utcNow);
    }

    internal static class Formatters
    {
        public const string NotePrefix = "Updated via Plugin at ";

        public static string FormatSyncNote(DateTime utcNow)
        {
            // Fixed round-trippable format (ISO 8601, 'Z' suffix). Stays under
            // the 500-char MaxLength of crfe6_sync_notes by a wide margin.
            return NotePrefix + utcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
        }
    }

    internal static class AccountFields
    {
        public const string SalesforceId = "crfe6_salesforceid";
        public const string Uen = "crfe6_uen";
        public const string LastModifiedByIntegrationAt = "crfe6_lastmodifiedbyintegration_at";
        public const string SyncNotes = "crfe6_sync_notes";
    }

    internal static class SdkConstants
    {
        public const string Target = "Target";
    }

    internal enum PipelineStage
    {
        PreValidation = 10,
        PreOperation = 20,
        MainOperation = 30,
        PostOperation = 40
    }
}
