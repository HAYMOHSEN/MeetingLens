using System.Windows;

namespace MeetingLens.Windows;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.Ordinal)) return ProtocolTests.Run();
        var app = new Application();
        app.DispatcherUnhandledException += (_, eventArgs) =>
        {
            MessageBox.Show(eventArgs.Exception.Message, "MeetingLens", MessageBoxButton.OK, MessageBoxImage.Error);
            eventArgs.Handled = true;
        };
        app.Run(new StudioWindow());
        return 0;
    }

}
