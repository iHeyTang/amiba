from pathlib import Path
import sys
import importlib

# The backplane root IS the hermes_x_backplane package (package-dir = "."),
# so the root __init__.py uses relative imports that only work when the package is
# imported as "hermes_x_backplane", not as a bare module from a file path.
#
# pytest treats any directory with __init__.py as a Package node and calls
# Package.setup() which imports root/__init__.py via import_path().  With
# importlib mode, import_path() calls module_name_from_path(root/__init__.py,
# rootdir) which returns "__init__", then checks sys.modules["__init__"] before
# trying to exec the file.  We pre-populate sys.modules["__init__"] with the
# already-installed hermes_x_backplane module so pytest returns the
# cached module instead of exec'ing the file bare (which would fail on relative
# imports).


def pytest_configure(config) -> None:
    """Prevent Package.setup() from exec'ing root/__init__.py as a bare module.

    import_path(root/__init__.py, mode='importlib', root=rootdir) resolves the
    module name as "__init__" (because the rootdir itself IS the package root
    via the editable install's custom finder, so resolve_pkg_root_and_module_name
    raises CouldNotResolvePathError and the fallback module_name_from_path
    returns "__init__").  We pre-populate sys.modules["__init__"] with the
    installed package module so import_path returns it from cache without
    exec'ing the file.
    """
    try:
        pkg = importlib.import_module("hermes_x_backplane")
        # The unique name pytest generates for root/__init__.py relative to rootdir
        sys.modules.setdefault("__init__", pkg)
    except ImportError:
        pass  # Not installed; relative-import error will surface but that's ok

