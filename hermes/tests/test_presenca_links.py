"""Cenários de páginas públicas, sem acessar perfis ou enviar mensagens."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "mktech-prospeccao" / "scripts"))
import presenca_links as pl
import inspecionar_presenca as ip

NOME = "Ana Costa Massoterapia"
TEXTO = "Ana Costa — Sobre meu trabalho. Sou especialista em massoterapia e ofereço serviços de massagem relaxante, com atendimento individual e técnicas adaptadas às necessidades de cada pessoa."


class Conteudo(unittest.TestCase):
    def classificar(self, url="https://ana.wixsite.com/espaco", texto=TEXTO, paragrafos=None, links=None, **kwargs):
        return pl.classificar_pagina(url, "Ana Costa", texto, [TEXTO] if paragrafos is None else paragrafos, links or [], NOME, **kwargs)

    def test_pagina_personalizada_no_wix_nao_precisa_de_dominio_proprio(self):
        r = self.classificar()
        self.assertEqual(r["tipo"], "pagina_personalizada")
        self.assertTrue(r["hospedagem_terceiros"])
        self.assertTrue(r["sinais_identidade"])

    def test_landing_curta_com_um_link_conta_como_pagina(self):
        self.assertEqual(self.classificar(links=["https://wa.me/5511999999999"])["tipo"], "pagina_personalizada")

    def test_canva_sem_tags_p_mas_com_conteudo_de_apresentacao(self):
        self.assertEqual(self.classificar(url="https://ana.my.canva.site/", texto=TEXTO * 5, paragrafos=[])["tipo"], "pagina_personalizada")

    def test_linktree_so_com_botoes_nao_e_pagina_personalizada(self):
        r = self.classificar(url="https://linktr.ee/anacosta", texto="Ana Costa\nInstagram\nWhatsApp\nAgendar", paragrafos=[], links=["https://instagram.com/anacosta", "https://wa.me/5511999999999"])
        self.assertEqual(r["tipo"], "agregador_links")

    def test_hub_rico_pode_ser_pagina_personalizada(self):
        self.assertEqual(self.classificar(url="https://beacons.ai/anacosta")["tipo"], "pagina_personalizada")

    def test_agenda_e_categoria_separada(self):
        self.assertEqual(self.classificar(url="https://www.trinks.com/ana", texto="Ana Costa\nAgendar massagem", paragrafos=[])["tipo"], "agendamento")

    def test_pagina_de_outro_negocio_na_mesma_cidade_nao_confirma_identidade(self):
        r = pl.classificar_pagina("https://outro.com.br", "Mariana Silva", TEXTO.replace("Ana Costa", "Mariana Silva") + " Franca", [TEXTO], [], NOME)
        self.assertEqual(r["tipo"], "verificacao_pendente")
        self.assertFalse(r["identidade_confirmada"])

    def test_nome_generico_ou_so_primeiro_nome_nao_bastam(self):
        self.assertEqual(pl.identificar("Clínica Ana em Franca", "Clínica Ana"), [])

    def test_telefone_e_instagram_podem_confirmar_negocio_com_nome_curto(self):
        self.assertTrue(pl.identificar("Contato (11) 99999-9999", "Studio Ana", "5511999999999"))
        self.assertTrue(pl.identificar("https://www.instagram.com/ana.costa/", "Studio Ana", instagram="@ana.costa"))
        self.assertFalse(pl.identificar("https://instagram.com/ana.costasilva/", "Studio Ana", instagram="@ana.costa"))
        self.assertFalse(pl.identificar("https://instagram.com/ana.costa.silva/", "Studio Ana", instagram="@ana.costa"))

    def test_texto_de_cookies_nao_transforma_botoes_em_pagina_personalizada(self):
        cookie = "Usamos cookies para personalizar sua experiência e analisar os acessos a esta plataforma. Leia a política de privacidade para mais informações."
        r = self.classificar(url="https://linktr.ee/ana", texto="Ana Costa\nSobre\nServiços\nWhatsApp\n" + cookie, paragrafos=[cookie])
        self.assertEqual(r["tipo"], "agregador_links")

    def test_pagina_bloqueada_ou_sem_conteudo_fica_pendente(self):
        self.assertEqual(self.classificar(texto="Ana Costa — Verify you are human")["tipo"], "verificacao_pendente")
        self.assertEqual(self.classificar(texto="Ana Costa", paragrafos=[])["tipo"], "verificacao_pendente")

    def test_dominios_sao_comparados_por_limite_real(self):
        self.assertIsNone(pl.tipo_destino("https://wa.me.falso.com/pagina"))
        self.assertIsNone(pl.tipo_destino("https://negocio.com/?url=whatsapp.com"))
        self.assertEqual(pl.tipo_destino("https://api.whatsapp.com/send?phone=5511999999999"), "whatsapp_direto")

    def test_link_de_pagina_personalizada_preserva_query(self):
        links = pl.links_para_conferir(["https://pagina.com/perfil?id=ana", "https://wa.me/5511999999999", "javascript:alert(1)", "http://127.0.0.1/admin", "https://pagina.com/perfil?id=ana"], "https://linktr.ee/ana")
        self.assertEqual(links, ["https://pagina.com/perfil?id=ana"])

    def test_nao_aceita_enderecos_locais_nem_credenciais(self):
        for url in ("http://localhost:3000", "http://192.168.0.1/", "http://10.1.1.1", "file:///secret", "https://user:pass@example.com"):
            self.assertFalse(pl.url_publica(url), url)


class Conclusao(unittest.TestCase):
    def test_bio_bloqueada_nunca_vira_sem_pagina(self):
        self.assertEqual(pl.resumir_presenca([], False, True), ("nao_verificado", "precisa_conferir"))

    def test_link_pendente_vence_busca_negativa(self):
        self.assertEqual(pl.resumir_presenca([{"tipo": "verificacao_pendente"}], True, True)[0], "nao_verificado")

    def test_site_confirmado_vence_limite_de_outras_fontes(self):
        self.assertEqual(pl.resumir_presenca([{"tipo": "pagina_personalizada"}, {"tipo": "verificacao_pendente"}], False, False)[0], "site_proprio")

    def test_categorias_sem_site_personalizado_so_com_inspecao_conclusiva(self):
        for tipo, esperado in (("agregador_links", "so_agregador"), ("whatsapp_direto", "so_whatsapp"), ("agendamento", "so_agendamento")):
            self.assertEqual(pl.resumir_presenca([{"tipo": tipo}], True, True)[0], esperado)
            self.assertEqual(pl.resumir_presenca([{"tipo": tipo}], True, False)[0], "nao_verificado")

    def test_busca_negativa_nao_e_garantia_de_inexistencia(self):
        self.assertEqual(pl.resumir_presenca([], True, True), ("sem_site", "nenhuma_pagina_localizada"))


class PaginaFinal(unittest.TestCase):
    def test_lote_pode_carregar_inspetor_por_runpy_fora_da_pasta_scripts(self):
        import subprocess
        import tempfile
        script = Path(ip.__file__).resolve()
        with tempfile.TemporaryDirectory() as pasta:
            r = subprocess.run([sys.executable, "-c", "import runpy,sys; sys.argv=[sys.argv[1], '--help']; runpy.run_path(sys.argv[0], run_name='__main__')", str(script)], cwd=pasta, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--instagram", r.stdout)

    def test_busca_nao_ignora_paginas_em_plataformas_de_links(self):
        page = MagicMock()
        link = MagicMock(); link.get_attribute.return_value = "https://linktr.ee/anacosta"; link.inner_text.return_value = NOME
        page.query_selector_all.return_value = [link]
        with patch.object(ip, "abrir", return_value=200):
            links, ok = ip.buscar_site(page, NOME, "Franca")
        self.assertTrue(ok)
        self.assertIn("https://linktr.ee/anacosta", links)

    def test_link_da_bio_preserva_parametros_e_escapes_do_destino(self):
        from urllib.parse import quote
        destino = "https://pagina.com/perfil?id=ana&ref=meu%26site"
        page = MagicMock()
        meta = MagicMock(); meta.get_attribute.return_value = "100 followers, 20 following, 30 posts"
        header = MagicMock(); header.inner_text.return_value = "anacosta\nAna Costa\nMassoterapia"
        page.query_selector.side_effect = lambda seletor: meta if seletor.startswith("meta[") else header
        page.inner_text.return_value = "Ana Costa\n100 followers"
        link = MagicMock(); link.get_attribute.return_value = "https://l.instagram.com/?u=" + quote(destino, safe="")
        page.query_selector_all.side_effect = lambda seletor: [] if seletor == "time[datetime]" else [link]
        with patch.object(ip, "abrir", return_value=200):
            ig = ip.instagram(page, "anacosta")
        self.assertEqual(ig["links_bio"], [destino])
        self.assertTrue(ig["bio_verificada"])

    def test_abre_redirecionamento_e_guarda_destino_e_evidencia(self):
        page = MagicMock()
        page.url = "https://ana.wixsite.com/pagina?id=ana"
        page.title.return_value = NOME
        page.inner_text.return_value = TEXTO
        page.query_selector.return_value = object()
        p = MagicMock(); p.inner_text.return_value = TEXTO
        page.query_selector_all.side_effect = [[p], []]
        with patch.object(ip, "abrir", return_value=200):
            r = ip.link_externo(page, "https://bit.ly/ana", NOME)
        self.assertEqual(r["url"], "https://bit.ly/ana")
        self.assertEqual(r["url_final"], page.url)
        self.assertEqual(r["tipo"], "pagina_personalizada")
        self.assertIn("serviços", r["trecho"])

    def test_whatsapp_nao_e_aberto(self):
        page = MagicMock()
        with patch.object(ip, "abrir") as abrir:
            self.assertEqual(ip.link_externo(page, "https://wa.me/5511999999999", NOME)["tipo"], "whatsapp_direto")
            abrir.assert_not_called()

    def test_erro_http_nao_comprova_site_existente_nem_ausente(self):
        page = MagicMock(); page.url = "https://pagina.com/ana"
        with patch.object(ip, "abrir", return_value=403):
            self.assertEqual(ip.link_externo(page, page.url, NOME)["tipo"], "verificacao_pendente")

    def test_falha_de_leitura_vira_pendencia_sem_abortar_inspecao(self):
        page = MagicMock(); page.url = "https://pagina.com/ana"
        page.title.side_effect = TimeoutError("timed out")
        with patch.object(ip, "abrir", return_value=200):
            self.assertEqual(ip.link_externo(page, page.url, NOME)["tipo"], "verificacao_pendente")

    def test_evidencias_respeitam_limite_do_crm_sem_perder_pagina_confirmada(self):
        detalhes = [{"url": f"https://pagina.com/{i}", "dominio": "pagina.com", "tipo": "verificacao_pendente"} for i in range(22)]
        detalhes.append({"url": "https://ana.carrd.co", "dominio": "ana.carrd.co", "tipo": "pagina_personalizada", "trecho": TEXTO})
        ev = ip.evidencias({"nome": NOME, "cidade": "Franca", "verificado_em": "2026-10-18", "instagram": {}, "facebook": {}, "site": {"situacao": "site_proprio", "detalhe": detalhes}})
        self.assertLessEqual(len(ev), 20)
        self.assertEqual(ev[0]["url"], "https://ana.carrd.co")


class InspecaoCompleta(unittest.TestCase):
    def executar(self, detalhes, bio=True, busca=True):
        manager = MagicMock()
        api = SimpleNamespace(sync_playwright=MagicMock(return_value=manager))
        def resultado(page, url, *args):
            return {"url": url, "url_final": url, "dominio": pl.dominio(url), **detalhes[url]}
        a = SimpleNamespace(nome=NOME, cidade="Franca", instagram="anacosta", telefone="5511999999999", facebook="", site="", servicos=2)
        ig = {"status": "ok", "handle": "anacosta", "url": "https://instagram.com/anacosta/", "bio_verificada": bio, "links_bio": ["https://linktr.ee/ana"]}
        with patch.dict(sys.modules, {"playwright.sync_api": api}), patch.object(ip, "instagram", return_value=ig), patch.object(ip, "facebook", return_value={"status": "nao_informado"}), patch.object(ip, "buscar_site", return_value=([], busca)), patch.object(ip, "link_externo", side_effect=resultado):
            return ip.inspecionar(a)

    def test_encontra_site_atras_do_linktree_e_registra_destino(self):
        r = self.executar({"https://linktr.ee/ana": {"tipo": "agregador_links", "links_encontrados": ["https://ana.carrd.co/"]}, "https://ana.carrd.co/": {"tipo": "pagina_personalizada", "sinais_identidade": ["nome do negócio coincidente"], "trecho": TEXTO}})
        self.assertEqual(r["site"]["grupo"], "tem_pagina_personalizada")
        self.assertEqual(r["site_status_sugerido"], "site_proprio_encontrado")
        self.assertEqual(r["componentes"]["lacuna_digital"], 0)
        self.assertTrue(any(e["url"] == "https://ana.carrd.co/" and "Conteúdo observado" in e["summary"] for e in r["evidencias"]))

    def test_limite_de_links_gera_pendencia_em_vez_de_ausencia(self):
        r = self.executar({"https://linktr.ee/ana": {"tipo": "agregador_links", "links_limitados": True, "links_encontrados": []}})
        self.assertEqual(r["site_status_sugerido"], "verificacao_pendente")
        self.assertTrue(r["pending_items"])
        self.assertTrue(any("limitation" in e for e in r["evidencias"]))

    def test_bio_bloqueada_preserva_verificacao_pendente_no_resultado_final(self):
        r = self.executar({"https://linktr.ee/ana": {"tipo": "agregador_links", "links_encontrados": []}}, bio=False)
        self.assertEqual(r["site_status_sugerido"], "verificacao_pendente")
        self.assertEqual(r["site"]["grupo"], "precisa_conferir")
        self.assertEqual(r["componentes"]["lacuna_digital"], 0)


if __name__ == "__main__":
    unittest.main()
