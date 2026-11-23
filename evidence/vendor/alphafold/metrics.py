# Copyright 2021 DeepMind Technologies Limited
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


# Adaptation: selected original functions and their required imports only.
from typing import Optional
import numpy as np

def _softmax(x: np.ndarray, axis: Optional[int] = None):
  x = np.asarray(x)
  x_max = np.max(x, axis=axis, keepdims=True)
  exp_x_shifted = np.exp(x - x_max)
  return exp_x_shifted / np.sum(exp_x_shifted, axis=axis, keepdims=True)

def compute_plddt(logits: np.ndarray) -> np.ndarray:
  """Computes per-residue pLDDT from logits.

  Args:
    logits: [num_res, num_bins] output from the PredictedLDDTHead.

  Returns:
    plddt: [num_res] per-residue pLDDT.
  """
  num_bins = logits.shape[-1]
  bin_width = 1.0 / num_bins
  bin_centers = np.arange(start=0.5 * bin_width, stop=1.0, step=bin_width)
  probs = np.array(_softmax(logits, axis=-1))
  predicted_lddt_ca = np.sum(probs * bin_centers[None, :], axis=-1)
  return predicted_lddt_ca * 100
