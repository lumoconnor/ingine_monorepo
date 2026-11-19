/// Opens one window on the sandbox build, which starts in the procedural world.
pub fn run() {
    let builder = tauri::Builder::default();

    // Tauri's default macOS menu binds Cmd+W to "Close Window", and Cmd is one of the
    // game's crouch keys. This menu keeps Cmd+Q (quit) and native fullscreen
    // (Ctrl+Cmd+F) and nothing that clashes with the controls. Windows and Linux get
    // no menu bar by default, so the game has the whole window there.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| {
        use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
        let app_menu = Submenu::with_items(
            app,
            "Ingine World",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        let window_menu = Submenu::with_items(
            app,
            "Window",
            true,
            &[
                &PredefinedMenuItem::fullscreen(app, None)?,
                &PredefinedMenuItem::minimize(app, None)?,
            ],
        )?;
        Menu::with_items(app, &[&app_menu, &window_menu])
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running the Ingine World app");
}
