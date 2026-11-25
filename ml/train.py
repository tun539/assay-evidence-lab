"""Train a small bilingual experiment on grouped, authored synthetic prompts."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

COLORS = [('red', 'rojo'), ('blue', 'azul'), ('green', 'verde')]
SHAPES = [('ball', 'esfera'), ('cube', 'cubo')]
ACTIONS = [('drop', 'suelta'), ('slide', 'desliza')]
TEMPLATES = [
    '{} the {} {}', 'please {} the {} {}', 'now {} the {} {}',
    '{} a {} {} please', 'could you {} the {} {}', '{} one {} {} now',
    '{} la {} de color {}', 'por favor {} la {} de color {}', 'ahora {} la {} de color {}',
    '{} una {} de color {} por favor', 'puedes {} la {} de color {}', '{} una {} de color {} ahora',
]
ROOT = Path(__file__).resolve().parents[1]


def dataset():
    rows = []
    for index, template in enumerate(TEMPLATES):
        lang = index // 6
        for action in ACTIONS:
            for shape in SHAPES:
                for color in COLORS:
                    slots = (action[lang], color[lang], shape[lang]) if lang == 0 else (action[lang], shape[lang], color[lang])
                    prompt = template.format(*slots)
                    if lang == 1 and shape[0] == 'cube':
                        prompt = prompt.replace(' la cubo', ' el cubo').replace(' una cubo', ' un cubo')
                    rows.append((index, 'en' if lang == 0 else 'es', prompt, '|'.join((action[0], shape[0], color[0]))))
    return pd.DataFrame(rows, columns=['template', 'language', 'prompt', 'meaning'])


def prepare():
    data = dataset()
    train = data.loc[~data.template.isin([4, 5, 10, 11])].copy()
    test = data.loc[data.template.isin([4, 5, 10, 11])].copy()
    assert set(train.template).isdisjoint(test.template)
    vocab = sorted({token for prompt in train.prompt for token in prompt.split()})
    meanings = sorted(train.meaning.unique())
    def encode(frame):
        features = np.asarray([[prompt.split().count(token) for token in vocab] for prompt in frame.prompt], dtype=np.float32)
        labels = np.array([meanings.index(label) for label in frame.meaning], dtype=np.int64)
        return features, labels
    return data, train, test, vocab, meanings, *encode(train), *encode(test)


def softmax(logits):
    scores = np.exp(logits - logits.max(axis=-1, keepdims=True))
    return scores / scores.sum(axis=-1, keepdims=True)


def fit_numpy(x, y, n_classes, steps=650, rate=0.6):
    weights = np.zeros((x.shape[1], n_classes))
    bias = np.zeros(n_classes)
    targets = np.eye(n_classes)[y]
    losses = []
    for _ in range(steps):
        probabilities = softmax(x @ weights + bias)
        losses.append(float(-np.log(probabilities[np.arange(len(y)), y]).mean()))
        gradient = (probabilities - targets) / len(y)
        weights -= rate * x.T @ gradient
        bias -= rate * gradient.sum(axis=0)
    return weights, bias, losses


def main():
    _, train, test, vocab, meanings, x, y, xt, yt = prepare()
    weights, bias, losses = fit_numpy(x, y, len(meanings))
    accuracy = float((softmax(xt @ weights + bias).argmax(axis=1) == yt).mean())
    payload = dict(vocab=vocab, meanings=meanings, weights=weights.tolist(), bias=bias.tolist(),
                   accuracy=accuracy, train=len(train), test=len(test), loss=[losses[0], losses[-1]],
                   dictionary=[list(pair) for pair in ACTIONS + SHAPES + COLORS])
    (ROOT / 'studio' / 'language-model.js').write_text('const languageModel = '+json.dumps(payload)+';\n')
    print(f'{len(train)} training, {len(test)} held-out prompts, accuracy {accuracy:.3f}')


if __name__ == '__main__':
    main()
