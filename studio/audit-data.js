window.auditExample = {
  "schema": "evidence-audit/1",
  "source": "Synthetic classroom fixtures",
  "upstream": {
    "cellpose": "a54cb48849b7e225a81e8e43dcb042d42427f543",
    "alphafold": "c77e5d2a8961d1a353632c462914ff0a32a950f6"
  },
  "runs": [
    {
      "kind": "mask",
      "reference_objects": 2,
      "predicted_objects": 2,
      "rows": [
        {
          "threshold": 0.5,
          "tp": 2,
          "fp": 0,
          "fn": 0,
          "score": 1.0
        },
        {
          "threshold": 0.75,
          "tp": 1,
          "fp": 1,
          "fn": 1,
          "score": 0.3333333333333333
        },
        {
          "threshold": 0.9,
          "tp": 1,
          "fp": 1,
          "fn": 1,
          "score": 0.3333333333333333
        }
      ]
    },
    {
      "kind": "confidence",
      "scores": [
        50.0,
        86.50933313267456,
        13.490666867325455,
        62.169777710891516
      ],
      "mean": 53.04244442772288
    }
  ]
};
