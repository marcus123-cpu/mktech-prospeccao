"""Run the installed CRM client with the skill's newer discard-reason option.

Only the finish parser/function are supplied from the workspace client.
Credentials, request implementation and other commands remain the installed client's.
"""
import ast
import pathlib
import sys

sys.stdout.reconfigure(encoding='utf-8')
installed = pathlib.Path(r'C:\Users\pmarc\AppData\Local\hermes\skills\mktech\mktech-prospeccao\scripts\mktech_crm.py')
updated = pathlib.Path(__file__).parent / 'scripts' / 'mktech_crm.py'
old_source = installed.read_text(encoding='utf-8-sig')
new_source = updated.read_text(encoding='utf-8-sig')
old_tree, new_tree = ast.parse(old_source), ast.parse(new_source)
old_fn = next(n for n in old_tree.body if isinstance(n, ast.FunctionDef) and n.name == 'cmd_finish')
new_fn = next(n for n in new_tree.body if isinstance(n, ast.FunctionDef) and n.name == 'cmd_finish')
old_lines = old_source.splitlines(keepends=True)
new_lines = new_source.splitlines(keepends=True)
old_lines[old_fn.lineno-1:old_fn.end_lineno] = new_lines[new_fn.lineno-1:new_fn.end_lineno]
source = ''.join(old_lines).replace('f.add_argument("--notes")', 'f.add_argument("--notes")\n    f.add_argument("--discard-reason", action="append")')
exec(compile(source, str(installed), 'exec'), {'__file__':str(installed),'__name__':'__main__'})
