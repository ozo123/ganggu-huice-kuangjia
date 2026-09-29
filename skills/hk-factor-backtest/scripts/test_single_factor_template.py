"""Contract checks for the reusable renderer and saved-state adapter."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from render_single_factor import render, write_payload
from single_factor_from_state import annual_from_nav, publish


def example():
    return {'meta':{'title':'Independent seven-day experiment'},
        'factors':[{'id':'alpha','name':'Arbitrary factor','formula':'F = X / Y','status':'completed'}],
        'contexts':[{'id':'custom','label':'Seven days'}],
        'results':[{'factor_id':'alpha','context_id':'custom','dates':['2021-12-31','2022-01-04'],
            'portfolios':[{'id':'LS','role':'LS','nav':[1.1,1.21]}]}],
        'correlations':[], 'experiments':[], 'method':[], 'downloads':[]}


class SingleFactorTemplate(unittest.TestCase):
    def test_independent_input_and_portable_series(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder); data = example()
            row = data['results'][0]
            payload = {'dates':row.pop('dates'),'portfolios':row.pop('portfolios')}
            row.update(id='row1',portfolios=[{'id':'LS','role':'LS'}],payload='series/a.js',payload_key='row1')
            write_payload(base/'series/a.js','row1',payload)
            (base/'input.json').write_text(json.dumps(data),encoding='utf-8')
            render(base/'input.json',base/'report')
            self.assertEqual((base/'series/a.js').read_bytes(),(base/'report/series/a.js').read_bytes())
            self.assertTrue((base/'report/assets/plotly.min.js').is_file())
            self.assertIn('Independent seven-day experiment',(base/'report/report-data.js').read_text(encoding='utf-8'))

    def test_invalid_input_does_not_replace_report(self):
        failures = []
        d = example(); d['results'][0]['portfolios'][0]['nav'] = [1]; failures.append(d)
        d = example(); d['results'].append(copy.deepcopy(d['results'][0])); failures.append(d)
        d = example(); d['downloads'] = [{'label':'Missing','href':'absent.csv'}]; failures.append(d)
        d = example(); d['correlations'] = [{'context_id':'custom','ids':['alpha','beta'],'values':[[1]]}]; failures.append(d)
        d = example(); d['results'][0]['ic_mean'] = float('nan'); failures.append(d)
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder); (base/'dashboard.html').write_text('Original',encoding='utf-8')
            for data in failures:
                (base/'input.json').write_text(json.dumps(data),encoding='utf-8')
                with self.assertRaises(ValueError): render(base/'input.json',base)
                self.assertEqual((base/'dashboard.html').read_text(encoding='utf-8'),'Original')

    def test_distinct_parameter_versions_are_not_collapsed(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder); data=example()
            data['results'][0].update(id='v1',variant='n=7')
            second=copy.deepcopy(data['results'][0]); second.update(id='v2',variant='n=11'); data['results'].append(second)
            (base/'input.json').write_text(json.dumps(data),encoding='utf-8')
            render(base/'input.json',base)
            receipt=json.loads((base/'template-render-verification.json').read_text())
            self.assertEqual(receipt['settings'],2)

    def test_year_boundary_includes_first_session(self):
        returns=annual_from_nav(['2021-12-30','2021-12-31','2022-01-04','2022-01-05'],[1,1.1,1.21,1.331])
        self.assertAlmostEqual(returns['2021'],.1)
        self.assertAlmostEqual(returns['2022'],.21)
        self.assertAlmostEqual((1+returns['2021'])*(1+returns['2022']),1.331)
        self.assertEqual(annual_from_nav(['2022-01-04'],[1],False),{})

    def test_state_adapter_preserves_metrics_without_series(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            state={'config':{},'records':[{'id':'custom','name':'Custom','path':str(base/'missing'),
                'spec':{'expression':'close/lag(close,7)-1'},'settings':{'cash__7':{'status':'completed','cagr':.123,'annualized_return':.135,'net_sharpe':0,'max_drawdown':-.1}}}]}
            original=copy.deepcopy(state)
            publish(state,base)
            data=json.loads((base/'report-input.json').read_text(encoding='utf-8'))
            self.assertEqual(data['results'][0]['portfolios'][0]['cagr'],.123)
            self.assertEqual(data['results'][0]['portfolios'][0]['annualized_return'],.135)
            self.assertEqual(data['results'][0]['portfolios'][0]['sharpe'],0)
            self.assertEqual(state,original)
            self.assertEqual(data['contexts'][0]['dimensions']['hold'],'7日')


if __name__ == '__main__': unittest.main()
