"""見込み: 全画面のキー色だけを抜き、白い服や閉じた隙間を区別する。
合格: 指定色の隙間/外側が透明で内部RGB不変、境界と既存alpha保持。
範囲: 合成PNGの実画素処理。Qwen生成画の指示追従・品質は未確認。
"""
import io
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from PIL import Image
from qwen_background import remove_chroma_background


def keyed(source, color, despill=True):
    raw=io.BytesIO();source.save(raw,format='PNG')
    return Image.open(io.BytesIO(remove_chroma_background(raw.getvalue(),
        {'color':color,'similarity':.08,'blend':.12,'despill':despill}))).convert('RGBA')


class ChromaTests(unittest.TestCase):
    # 見込み: 緑/青/マゼンタは連結性によらず抜ける。
    # 合格: 閉じた穴と外側alpha0、白/黒/有色内部RGB完全一致。範囲: 合成64px。
    def test_three_colors_preserve_foreground_and_remove_enclosed_gap(self):
        for key in ['#00FF00','#0000FF','#FF00FF']:
            image=Image.new('RGBA',(64,64),key)
            image.paste((255,255,255,255),(8,8,56,56))
            image.paste((0,0,0,255),(10,10,18,18))
            image.paste((90,120,160,128),(22,10,30,18))
            image.paste(key,(24,24,40,40))
            output=keyed(image,key)
            self.assertEqual(output.getpixel((0,0))[3],0)
            self.assertEqual(output.getpixel((32,32))[3],0)
            for xy in [(12,12),(20,20),(25,12)]:self.assertEqual(output.getpixel(xy),image.getpixel(xy))
            self.assertEqual(output.size,image.size)

    # 見込み: 距離による半透明と1pxのdespillなら内側RGBを変えない。
    # 合格: 境界alpha中間・緑過剰減少・非境界有色は不変。範囲: 合成境界のみ。
    def test_soft_alpha_and_boundary_only_despill(self):
        source=Image.new('RGBA',(16,16),'#00FF00')
        source.paste((80,160,90,255),(4,4,12,12))
        source.putpixel((3,7),(25,230,25,128))
        output=keyed(source,'#00FF00')
        self.assertGreater(output.getpixel((3,7))[3],0)
        self.assertLess(output.getpixel((3,7))[3],128)
        self.assertLess(output.getpixel((3,7))[1],230)
        self.assertEqual(output.getpixel((8,8)),source.getpixel((8,8)))
        untouched=keyed(source,'#00FF00',False)
        self.assertEqual(untouched.getpixel((3,7))[:3],source.getpixel((3,7))[:3])

if __name__=='__main__':unittest.main()
