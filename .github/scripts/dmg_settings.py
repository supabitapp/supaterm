application = defines["app"]
background = defines["background"]
icon = defines["icon"]
files = [(application, "Supaterm.app")]
symlinks = {"Applications": "/Applications"}
icon_locations = {
  "Supaterm.app": (180, 140),
  "Applications": (480, 140),
}
window_rect = ((10, 308), (660, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = True
text_size = 16
icon_size = 128
format = "ULFO"
filesystem = "HFS+"
