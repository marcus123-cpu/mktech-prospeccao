"""Testes da nota e dos auxiliares de inspecionar_presenca.py (sem navegador nem rede).

Rodar: python -m unittest discover -s hermes/tests -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "mktech-prospeccao" / "scripts"))
import inspecionar_presenca as ip  # noqa: E402


def base(site, ig=None, fb=None):
    return {"site": {"situacao": site, "detalhe": []}, "instagram": ig or {"status": "nao_informado"}, "facebook": fb or {"status": "nao_informado"}}


class Nota(unittest.TestCase):
    def test_sem_site_com_instagram_ativo_e_nota_alta(self):
        r = base("sem_site", {"status": "ok", "posts": 80, "seguidores": 2300})
        comp, nota, conf = ip.pontuar(r, 3, True)
        self.assertEqual(comp["lacuna_digital"], 50)
        self.assertGreaterEqual(nota, 80)

    def test_site_proprio_zera_a_lacuna(self):
        r = base("site_proprio", {"status": "ok", "posts": 80, "seguidores": 9000})
        self.assertEqual(ip.pontuar(r, 3, True)[0]["lacuna_digital"], 0)

    def test_so_linktree_continua_sendo_alvo(self):
        self.assertEqual(ip.pontuar(base("so_agregador", {"status": "ok", "posts": 20, "seguidores": 500}), 2, True)[0]["lacuna_digital"], 45)

    def test_sem_site_sem_rede_confirmada_tem_prova_menor(self):
        comp, _, conf = ip.pontuar(base("sem_site"), 0, False)
        self.assertEqual(comp["lacuna_digital"], 35)
        self.assertEqual(conf, "baixa")

    def test_busca_que_nao_respondeu_nao_vira_sem_site(self):
        comp, _, _ = ip.pontuar(base("nao_verificado"), 0, False)
        self.assertEqual(comp["lacuna_digital"], 0)


class Numeros(unittest.TestCase):
    def test_formatos(self):
        self.assertEqual(ip.numero("1,2 mil"), 1200)
        self.assertEqual(ip.numero("268M"), 268_000_000)
        self.assertEqual(ip.numero("12.345"), 12345)
        self.assertEqual(ip.numero("890"), 890)


if __name__ == "__main__":
    unittest.main()
