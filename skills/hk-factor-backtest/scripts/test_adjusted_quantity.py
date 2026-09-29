"""End-to-end source separation for adjusted factor quantities and raw eligibility."""
from pathlib import Path
import tempfile
import unittest
import numpy as np
import pandas as pd
from daily_data import prepare, factor_fields

class AdjustedQuantity(unittest.TestCase):
    def test_sources_and_missing_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir()
            dates=pd.bdate_range('2010-01-04',periods=35)
            base=pd.DataFrame(dict(code='00001.HK',date=dates,open=10.,high=11.,low=9.,close=10.,volume=100.,amount=4_000_000.))
            pd.DataFrame(dict(code=['00001.HK'],listing_date=['2000-01-01'])).to_csv(root/'ipo.csv',index=False)
            base.to_parquet(source/'raw.parquet')
            for mode,vol,amt in [('cash',200.,100.),('reinvest',300.,900.)]:
                base.assign(volume=vol,amount=amt).to_parquet(source/f'{mode}.parquet')
            cfg=dict(data_root=str(source),currency='HKD',amount_unit='HKD',ipo_dates_csv=str(root/'ipo.csv'),end='2010-12-31')
            out=root/'result';out.mkdir();ds=prepare(cfg,out)
            for mode,vol,amt in [('cash',200.,100.),('reinvest',300.,900.)]:
                f=factor_fields(ds,mode)
                np.testing.assert_equal(f['volume'],vol);np.testing.assert_equal(f['amount'],amt)
                np.testing.assert_equal(f['vwap'],amt/vol)
            pool=np.load(Path(ds['folder'])/'pool.npy');self.assertTrue(pool[4:].all())
            # Even a huge adjusted amount cannot admit a stock below the raw threshold.
            base.assign(amount=3_000_000.).to_parquet(source/'raw.parquet')
            base.assign(volume=300.,amount=1e12).to_parquet(source/'reinvest.parquet')
            # Missing cash quantity fields must never fall back to raw.
            base.drop(columns=['volume','amount']).to_parquet(source/'cash.parquet')
            ds2=prepare(cfg,out);self.assertNotEqual(ds['fingerprint'],ds2['fingerprint'])
            self.assertFalse(np.load(Path(ds2['folder'])/'pool.npy').any())
            f=factor_fields(ds2,'cash')
            self.assertNotIn('volume',f);self.assertNotIn('amount',f);self.assertNotIn('vwap',f)
            del f
            import gc
            gc.collect()

if __name__=='__main__':unittest.main()
