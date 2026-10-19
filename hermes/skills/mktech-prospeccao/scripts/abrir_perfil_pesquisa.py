#!/usr/bin/env python3
"""Abre o Chrome da PESQUISA, com janela visível, no mesmo perfil que o Hermes usa.

Use quando o Google pedir captcha ("tráfego incomum") ou para entrar uma vez numa conta DEDICADA do Instagram
(isso reduz o 'bloqueado_login' nas bios). Resolva o que aparecer e feche a janela: o perfil fica salvo.
Não use sua conta principal do Instagram nem da empresa.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

PERFIL = Path(os.environ.get("MKTECH_PERFIL_NAVEGADOR") or (Path.home() / ".mktech-perfil-pesquisa"))
PERFIL.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(str(PERFIL), channel="chrome", headless=False, locale="pt-BR",
                                               viewport=None, args=["--disable-blink-features=AutomationControlled", "--start-maximized"])
    pagina = ctx.pages[0] if ctx.pages else ctx.new_page()
    pagina.goto("https://www.google.com/search?q=teste&hl=pt-BR")
    ctx.new_page().goto("https://www.instagram.com/accounts/login/")
    print("Janela aberta. Resolva o captcha do Google e/ou entre na conta DEDICADA do Instagram. Feche a janela quando terminar.")
    try:
        ctx.wait_for_event("close", timeout=0)
    except Exception:
        pass
