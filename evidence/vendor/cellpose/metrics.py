"""
Copyright © 2025 Howard Hughes Medical Institute, Authored by Carsen Stringer , Michael Rariden and Marius Pachitariu.
"""

# Adaptation: selected original functions and their required imports only.
import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.sparse import csr_matrix

def _label_overlap(masks_true, masks_pred):
    return csr_matrix((np.ones((masks_true.size,), "int"),
                       (masks_true.flatten(), masks_pred.flatten())),
                      shape=(masks_true.max() + 1, masks_pred.max() + 1))

def _intersection_over_union(masks_true, masks_pred):
    """Calculate the intersection over union of all mask pairs.

    Parameters:
        masks_true (np.ndarray, int): Ground truth masks, where 0=NO masks; 1,2... are mask labels.
        masks_pred (np.ndarray, int): Predicted masks, where 0=NO masks; 1,2... are mask labels.

    Returns:
        iou (np.ndarray, float): Matrix of IOU pairs of size [x.max()+1, y.max()+1].

    How it works:
        The overlap matrix is a lookup table of the area of intersection
        between each set of labels (true and predicted). The true labels
        are taken to be along axis 0, and the predicted labels are taken
        to be along axis 1. The sum of the overlaps along axis 0 is thus
        an array giving the total overlap of the true labels with each of
        the predicted labels, and likewise the sum over axis 1 is the
        total overlap of the predicted labels with each of the true labels.
        Because the label 0 (background) is included, this sum is guaranteed
        to reconstruct the total area of each label. Adding this row and
        column vectors gives a 2D array with the areas of every label pair
        added together. This is equivalent to the union of the label areas
        except for the duplicated overlap area, so the overlap matrix is
        subtracted to find the union matrix.
    """
    if masks_true.size != masks_pred.size:
        raise ValueError("masks_true.size != masks_pred.size")
    overlap = _label_overlap(masks_true, masks_pred)
    overlap = overlap.toarray()
    n_pixels_pred = np.sum(overlap, axis=0, keepdims=True)
    n_pixels_true = np.sum(overlap, axis=1, keepdims=True)
    iou = overlap / (n_pixels_pred + n_pixels_true - overlap)
    iou[np.isnan(iou)] = 0.0
    return iou

def _true_positive(iou, th):
    """Calculate the true positive at threshold th.

    Args:
        iou (float, np.ndarray): Array of IOU pairs.
        th (float): Threshold on IOU for positive label.

    Returns:
        tp (float): Number of true positives at threshold.

    How it works:
        (1) Find minimum number of masks.
        (2) Define cost matrix; for a given threshold, each element is negative
            the higher the IoU is (perfect IoU is 1, worst is 0). The second term
            gets more negative with higher IoU, but less negative with greater
            n_min (but that's a constant...).
        (3) Solve the linear sum assignment problem. The costs array defines the cost
            of matching a true label with a predicted label, so the problem is to 
            find the set of pairings that minimizes this cost. The scipy.optimize
            function gives the ordered lists of corresponding true and predicted labels. 
        (4) Extract the IoUs from these pairings and then threshold to get a boolean array
            whose sum is the number of true positives that is returned. 
    """
    n_min = min(iou.shape[0], iou.shape[1])
    costs = -(iou >= th).astype(float) - iou / (2 * n_min)
    true_ind, pred_ind = linear_sum_assignment(costs)
    match_ok = iou[true_ind, pred_ind] >= th
    tp = match_ok.sum()
    return tp
