import copy
import unittest
from standalone_report import calculation_details, js_assignment


class FormulaDisplay(unittest.TestCase):
    def test_display_override_does_not_change_frozen_spec(self):
        spec={'definition':'original','parameters':{'n':20},'direction':-1}
        before=copy.deepcopy(spec)
        shown=calculation_details(spec,{'display_formula':'V / mean(V,n)','display_parameters':{'n':20},'direction':1})
        self.assertEqual(shown['formula'],'V / mean(V,n)')
        self.assertEqual(shown['prior_direction'],-1)
        self.assertEqual(spec,before)

    def test_expression_and_python_fallbacks_and_safe_script(self):
        self.assertEqual(calculation_details({'expression':'close/lag(close,5)-1','definition':'5 day return'})['formula'],'close/lag(close,5)-1')
        self.assertEqual(calculation_details({'python':'x.py','definition':'具体步骤'})['formula'],'具体步骤')
        self.assertIn('未提供',calculation_details({})['formula'])
        payload=js_assignment('HK_INDEX',{'formula':'</script><script>alert(1)</script>'})
        self.assertNotIn('</script>',payload)


if __name__=='__main__':unittest.main()
