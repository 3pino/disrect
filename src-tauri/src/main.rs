// Windows の配布版では、コンソールの窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fixplor_lib::run()
}
