import unittest
import numpy as np
from audit import masks, confidence, demo

class AuditTests(unittest.TestCase):
    def test_threshold_effect(self):
        self.assertEqual([r['tp'] for r in demo()[0]['rows']], [2,1,1])

    def test_sparse_ids_and_no_background(self):
        a=np.array([[3,3],[200000,200000]])
        self.assertEqual(masks(a,a)['rows'][0]['score'],1)

    def test_empty(self):
        a=np.zeros((2,2),int)
        self.assertIsNone(masks(a,a)['rows'][0]['score'])
        self.assertEqual(masks(a,a+1)['rows'][0]['fp'],1)

    def test_logits(self):
        np.testing.assert_allclose(confidence(np.zeros((3,4)))['scores'],50)
        with self.assertRaises(ValueError):
            confidence(np.array([[0,np.nan]]))
