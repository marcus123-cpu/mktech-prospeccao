"""Compatibilidade do finish atualizado com transporte do cliente instalado."""
import argparse
import importlib.util
import pathlib
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
base = pathlib.Path(__file__).parent

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result

installed = module('mktech_installed', r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py')
updated = module('mktech_finish_updated', base / 'scripts' / 'mktech_crm.py')
# Mantém autenticação, configuração e transporte exclusivamente no cliente indicado.
updated.request = installed.request
updated.emit = installed.emit
updated.fail = installed.fail
installed.cmd_finish = updated.cmd_finish
original_add = argparse.ArgumentParser.add_argument

def compatible_add(parser, *args, **kwargs):
    result = original_add(parser, *args, **kwargs)
    if args == ('--notes',) and parser.prog.endswith(' finish'):
        original_add(parser, '--discard-reason', action='append')
    return result

argparse.ArgumentParser.add_argument = compatible_add
raise SystemExit(installed.main(sys.argv[1:]))
