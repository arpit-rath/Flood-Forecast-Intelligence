"""Stage the allowlisted Lambda sources without repository or frontend files."""

from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(__file__).resolve().parent / ".lambda-package"
SOURCE_PATHS = (
    "backend/__init__.py",
    "backend/varuna/__init__.py",
    "backend/varuna/api.py",
    "backend/varuna/fixture.py",
    "backend/varuna/interventions.py",
    "backend/varuna/models.py",
    "backend/varuna/risk.py",
    "backend/varuna/routing.py",
    "backend/varuna/service.py",
    "data/fixture/scenario.json",
)
SOURCES = tuple(ROOT / path for path in SOURCE_PATHS)


def main() -> None:
    expected = {source.relative_to(ROOT).as_posix() for source in SOURCES}
    for source in SOURCES:
        if not source.is_file() or source.is_symlink():
            raise RuntimeError(f"Missing or unsafe Lambda source: {source}")

    if OUTPUT.exists() or OUTPUT.is_symlink():
        if OUTPUT.is_symlink() or not OUTPUT.is_dir():
            raise RuntimeError(f"Refusing to replace non-directory package output: {OUTPUT}")
        unexpected = [
            path.relative_to(OUTPUT).as_posix()
            for path in OUTPUT.rglob("*")
            if path.is_symlink()
            or (path.is_file() and path.relative_to(OUTPUT).as_posix() not in expected)
        ]
        if unexpected:
            raise RuntimeError(f"Refusing to replace package output with unexpected files: {unexpected}")
        shutil.rmtree(OUTPUT)

    for source in SOURCES:
        destination = OUTPUT / source.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    actual = {path.relative_to(OUTPUT).as_posix() for path in OUTPUT.rglob("*") if path.is_file()}
    if actual != expected:
        raise RuntimeError(f"Lambda package contents differ from allowlist: {actual ^ expected}")
    print(f"Staged {len(actual)} files in {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
