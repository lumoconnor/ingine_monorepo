// Stops an extra console window opening next to the game on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ingine_world_lib::run()
}
