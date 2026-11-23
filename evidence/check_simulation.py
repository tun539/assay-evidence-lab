"""Independently verify a force simulation export using upstream MACE error metrics."""
import argparse
import json
from pathlib import Path
import numpy as np
from vendor.mace.metrics import compute_mae, compute_rmse


def verify(report):
    if report['schema'] != 'scientific-simulation/1' or report['mode'] != 'force':
        raise ValueError('Select a force-law simulation report.')
    params, result = report['params'], report['result']
    grid = np.linspace(-params['width'], params['width'], 21)
    k = np.linalg.lstsq(grid[:, None], grid + 0.6 * grid**3, rcond=None)[0][0]
    positions = np.array(result['trace'])[:, 1]
    errors = positions + 0.6*positions**3 - k*positions
    np.testing.assert_allclose([k, compute_mae(errors), compute_rmse(errors)],
                               [result['stiffness'], result['mae'], result['rmse']], atol=1e-10)
    return len(errors)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    args = parser.parse_args()
    print('Verified stiffness, MAE and RMSE for', verify(json.loads(args.report.read_text())), 'frames')
