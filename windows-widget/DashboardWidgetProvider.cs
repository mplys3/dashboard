using Microsoft.Windows.Widgets.Providers;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace HaDashboardWidget;

[ComVisible(true)]
[ComDefaultInterface(typeof(IWidgetProvider))]
[Guid("79D91B63-72B8-40D6-9D54-65D76F4773F1")]
public sealed class DashboardWidgetProvider : IWidgetProvider
{
    public const string DefinitionId = "HA_Dashboard_Web_Widget";

    public void CreateWidget(WidgetContext widgetContext) => UpdateWidget(widgetContext.Id);

    public void DeleteWidget(string widgetId, string customState)
    {
    }

    public void Activate(WidgetContext widgetContext) => UpdateWidget(widgetContext.Id);

    public void Deactivate(string widgetId)
    {
    }

    public void OnActionInvoked(WidgetActionInvokedArgs actionInvokedArgs)
    {
        // Buttons are handled by the embedded dashboard page itself.
    }

    public void OnWidgetContextChanged(WidgetContextChangedArgs contextChangedArgs) =>
        UpdateWidget(contextChangedArgs.WidgetContext.Id);

    private static void UpdateWidget(string widgetId)
    {
        var request = new WidgetUpdateRequestOptions(widgetId)
        {
            Template = BuildWebWidgetTemplate(ReadDashboardUrl()),
            Data = "{}",
            CustomState = "web-dashboard-v1"
        };

        WidgetManager.GetDefault().UpdateWidget(request);
    }

    private static string BuildWebWidgetTemplate(string dashboardUrl)
    {
        var payload = new
        {
            type = "AdaptiveCard",
            schema = "http://adaptivecards.io/schemas/adaptive-card.json",
            version = "1.6",
            body = Array.Empty<object>(),
            metadata = new { webUrl = dashboardUrl }
        };

        var json = JsonSerializer.Serialize(payload);
        return json.Replace("\"schema\":", "\"$schema\":", StringComparison.Ordinal);
    }

    private static string ReadDashboardUrl()
    {
        var defaultUrl = "http://192.168.0.120:8088/?widget=1";
        var settingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HaDashboardWidget",
            "settings.json");

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(settingsPath));
            if (document.RootElement.TryGetProperty("dashboardUrl", out var value))
            {
                var configuredUrl = value.GetString();
                if (Uri.TryCreate(configuredUrl, UriKind.Absolute, out var uri) &&
                    (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                {
                    var builder = new UriBuilder(uri);
                    var query = builder.Query.TrimStart('?');
                    if (!query.Split('&', StringSplitOptions.RemoveEmptyEntries)
                        .Any(item => item.Equals("widget=1", StringComparison.OrdinalIgnoreCase)))
                    {
                        builder.Query = string.IsNullOrEmpty(query) ? "widget=1" : $"{query}&widget=1";
                    }

                    return builder.Uri.AbsoluteUri;
                }
            }
        }
        catch (IOException)
        {
        }
        catch (JsonException)
        {
        }

        return defaultUrl;
    }
}
