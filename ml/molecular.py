"""CPU benchmark for parameter inference and sequential enzyme assay design."""
from pathlib import Path
import json

import numpy as np
from sklearn.ensemble import RandomForestRegressor
import torch
from torch import nn

DOSES = np.array([.02, .06, .11, .22, .56, 1.1])
# Synthetic families of apparent Vmax and Km. These are teaching fixtures.
CENTERS = np.array([[145, .045], [210, .045], [145, .22], [210, .22]])
ANCHOR = 2
ACTIONS = np.array([0, 1, 3, 4, 5])
BINS = np.linspace(35, 150, 16)


def simulate(size, seed):
    rng = np.random.default_rng(seed)
    family = rng.integers(len(CENTERS), size=size)
    params = CENTERS[family] * np.exp(rng.normal(0, [.13, .23], (size, 2)))
    vmax, km = params.T
    rates = vmax[:, None] * DOSES / (km[:, None] + DOSES)
    rates += rng.normal(0, 11, rates.shape)
    return params, rates, family


def train_regressors(x, y):
    mean, scale = x.mean(axis=0), x.std(axis=0)
    target = np.column_stack([y[:,0]/180, np.log(y[:,1]/.1)])
    forest = RandomForestRegressor(n_estimators=96, min_samples_leaf=4, random_state=17, n_jobs=2).fit(x, target)
    torch.manual_seed(17)
    torch.set_num_threads(2)
    network = nn.Sequential(nn.Linear(6, 48), nn.ReLU(), nn.Linear(48, 32), nn.ReLU(), nn.Linear(32, 2))
    optimizer = torch.optim.Adam(network.parameters(), lr=.003)
    x_tensor = torch.tensor((x-mean)/scale, dtype=torch.float32)
    y_tensor = torch.tensor(target, dtype=torch.float32)
    for _ in range(125):
        optimizer.zero_grad()
        loss = nn.functional.mse_loss(network(x_tensor), y_tensor)
        loss.backward()
        optimizer.step()

    def neural(values):
        with torch.inference_mode():
            return network(torch.tensor((values-mean)/scale, dtype=torch.float32)).numpy()

    return forest.predict, neural


def decoder(train, labels, observed, action):
    """Gaussian prototype likelihood fitted on training curves only."""
    columns = [ANCHOR, action]
    centers = np.stack([train[labels==i][:,columns].mean(axis=0) for i in range(len(CENTERS))])
    variances = np.stack([train[labels==i][:,columns].var(axis=0) for i in range(len(CENTERS))])
    delta = observed[:,None,columns] - centers
    loss = (delta**2/variances + np.log(variances)).sum(axis=2)
    return loss.argmin(axis=1)


def train_policy(states, rewards):
    """Epsilon-greedy Q-learning for a one-step terminal experiment."""
    rng = np.random.default_rng(51)
    q = np.full((len(BINS)+1, len(ACTIONS)), .5)
    visits = np.zeros_like(q)
    for row in rng.integers(len(states), size=80_000):
        state = states[row]
        action = rng.integers(len(ACTIONS)) if rng.random()<.25 else q[state].argmax()
        visits[state,action] += 1
        q[state,action] += (rewards[row,action] - q[state,action])/visits[state,action]
    return q


def main():
    params, train, family = simulate(2400, 17)
    actual, test, truth = simulate(800, 91)
    forest, neural = train_regressors(train, params)
    metrics = {}
    for name, model in [('Random forest',forest), ('PyTorch MLP',neural)]:
        prediction = model(test)
        inferred = np.column_stack([prediction[:,0]*180, .1*np.exp(prediction[:,1])])
        metrics[name] = np.abs(actual-inferred).mean(axis=0).tolist()
    test_states = np.digitize(test[:,ANCHOR], BINS)
    # Fit the decoder and train the policy on independent simulated episodes.
    _, episodes, episode_truth = simulate(4800, 42)
    episode_states = np.digitize(episodes[:,ANCHOR], BINS)
    rewards = np.column_stack([decoder(train,family,episodes,a)==episode_truth for a in ACTIONS])
    decoded = np.column_stack([decoder(train,family,test,a) for a in ACTIONS])
    scores = decoded == truth[:, None]
    q = train_policy(episode_states,rewards)
    fixed = rewards.mean(axis=0).argmax()
    policy = q.argmax(axis=1)
    paired = scores[np.arange(len(scores)),policy[test_states]]
    difference = paired.astype(float) - scores[:,fixed]
    bootstrap = np.random.default_rng(73).choice(difference, size=(2000,len(difference))).mean(axis=1)
    interval = np.quantile(bootstrap, [.025,.975]).tolist()
    result = dict(gain=float(difference.mean()), gainInterval=interval, doses=DOSES.tolist(), anchor=ANCHOR, actions=ACTIONS.tolist(),
                  bins=BINS.tolist(), q=q.tolist(), metrics=metrics, train=len(train), test=len(test),
                  rlTrain=len(episodes), policies={'Learned policy':float(paired.mean()),
                         'Best fixed dose selected during training':float(scores[:,fixed].mean()),
                         'Uniform random dose (expected)':float(scores.mean())},
                  examples=[dict(family=int(truth[i]), rates=test[i].tolist(), params=actual[i].tolist(),
                                 decoded=decoded[i].tolist()) for i in range(18)])
    print(json.dumps(result['metrics'] | result['policies'],indent=2))
    dest=Path(__file__).resolve().parents[1]/'studio'/'molecular-data.js'
    dest.write_text('const molecularData = '+json.dumps(result,allow_nan=False)+';\n')


if __name__=='__main__':
    main()
