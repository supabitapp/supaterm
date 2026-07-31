application = defines["app"]
background = defines["background"]
icon = defines["icon"]
files = [(application, "Supaterm.app")]
symlinks = {"Applications": "/Applications"}
icon_locations = {
  "Supaterm.app": (190, 180),
  "Applications": (610, 180),
}
window_rect = ((110, 110), (800, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
text_size = 16
icon_size = 212
format = "ULFO"
filesystem = "HFS+"
