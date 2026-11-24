# Held-Out Prediction Reference Metrics

These CSVs are English-label copies of the existing W and LWBS model audit summaries. Their numeric values and column structure have not changed. Translation affects the `notes` field only.

- `03_w_model_metrics.csv`: held-out W prediction metrics, including MAE.
- `04_lwbs_model_metrics.csv`: held-out LWBS risk-discrimination metrics, including ROC-AUC and test sensitivity.

Prediction accuracy is **not** evidence that routing reduces W or nurse outreach reduces LWBS. The model-training scripts are not part of this final dashboard handoff. See the original project for the delivered prediction backend.
