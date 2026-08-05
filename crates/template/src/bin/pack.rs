use std::{env, fs, path::PathBuf, process};

use gewu_template::pack::{ContentPackManifest, build_manifest, verify_manifest};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("build") if args.len() == 5 => {
            build_manifest(PathBuf::from(&args[1]), &args[3], &args[4])
                .and_then(|manifest| {
                    let bytes = serde_json::to_vec_pretty(&manifest)
                        .map_err(|error| gewu_template::pack::PackError::Invalid(error.to_string()))?;
                    fs::write(&args[2], format!("{}\n", String::from_utf8_lossy(&bytes)))
                        .map_err(|source| gewu_template::pack::PackError::Io { path: PathBuf::from(&args[2]), source })
                })
                .map(|_| "content pack manifest written".to_owned())
        }
        Some("verify") if args.len() == 3 => fs::read_to_string(&args[2])
            .map_err(|error| gewu_template::pack::PackError::Io { path: PathBuf::from(&args[2]), source: error })
            .and_then(|contents| serde_json::from_str::<ContentPackManifest>(&contents).map_err(|error| gewu_template::pack::PackError::Invalid(error.to_string())))
            .and_then(|manifest| verify_manifest(PathBuf::from(&args[1]), &manifest))
            .map(|_| "content pack verified".to_owned()),
        _ => Err(gewu_template::pack::PackError::Invalid("usage: pack build <root> <manifest.json> <pack-id> <pack-version> | pack verify <root> <manifest.json>".to_owned())),
    };
    match result {
        Ok(message) => println!("{message}"),
        Err(error) => {
            eprintln!("GEWU: {error}");
            process::exit(1);
        }
    }
}
