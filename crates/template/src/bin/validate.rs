use std::{env, process::ExitCode};

use gewu_template::load_algorithm_unit;

fn main() -> ExitCode {
    let Some(path) = env::args().nth(1) else {
        eprintln!("usage: gewu-template-validate <unit.json>");
        return ExitCode::from(2);
    };

    match load_algorithm_unit(&path) {
        Ok(unit) => {
            println!("validated {} r{}", unit.id, unit.revision.get());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("template validation failed: {error}");
            ExitCode::FAILURE
        }
    }
}
