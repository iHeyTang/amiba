# Workbench terminal extension

Registers the terminal launcher and resource view in `amiba.workbench.view`. Every launch creates a new resource id and terminal process scoped to the current session. xterm rendering, theme, CSS and process cleanup belong to this plugin.

Switching tabs or collapsing the workbench retains the process; reopening hydrates its output. Closing a tab awaits `terminalStop`. A failed stop leaves the tab open for retry. The platform's workspace development adapter supplies terminal I/O. Without it the view reports that the terminal is unavailable.

The web bundle installs this plugin and `dsh-plugin-workbench`. It has no separate bottom panel or header shortcut.
