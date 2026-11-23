import unittest
import numpy as np
from model import fit, predict

class CurveTests(unittest.TestCase):
    def test_half_max(self):
        for state, expected in [(False, 50), (True, 75)]:
            self.assertAlmostEqual(predict([100,.1,150],.1,state,"split_vmax"), expected)

    def test_recover_two_curves(self):
        x = np.tile([.02,.06,.2,.7,1.1], 2)
        treated = np.repeat([False, True], 5)
        truth = [180,.06,220,.08]
        y = predict(truth,x,treated,"split_both")
        np.testing.assert_allclose(fit(x,y,treated,"split_both"),truth,rtol=1e-6)
