# Simulation & Conformational Ensemble Workbench (`studio/simulation.html`)

Open `studio/simulation.html` online or in the downloaded offline Studio. Every figure, trajectory, vibrational spectrum, 2D contour map, and 3D protein conformer morph is computed directly in the browser with zero external network dependencies.

---

## Track A · Force-Field Learning, OOD Extrapolation & Symplectic MD (`MACE` / `MDsim` / `molML`)

Inspired by **[MACE](https://github.com/ACEsuit/mace)** (*Batatia, Kovács, Simm, Ortner & Csányi, NeurIPS 2022*) and **[Forces Are Not Enough (`MDsim`)](https://arxiv.org/abs/2210.07237)** (*Fu et al., ICLR 2023*):

- **5 Reference Physical Potentials:**
  1. **Anharmonic Quartic Oscillator (`quartic`):** $U(x) = \tfrac{1}{2}x^2 + 0.15x^4$, $F(x) = -x - 0.6x^3$ *(canonical MACE checker benchmark)*.
  2. **Morse Covalent Bond Dissociation (`morse`):** $U(x) = D_e(1 - e^{-a x})^2$ *(asymmetric compression wall vs. OOD bond breaking)*.
  3. **Lennard–Jones 12–6 Nonbonded Pair (`lj`):** $U(r) = 4\varepsilon[(\sigma/r)^{12} - (\sigma/r)^6]$ *(Pauli repulsion vs. dispersion tail)*.
  4. **3BPA-Inspired Multi-Minima Dihedral Rotor (`torsion`):** $U(\theta) = \sum_{m=1}^{3} \tfrac{1}{2}V_m(1 - \cos m\theta)$.
  5. **Reactive Proton-Transfer Double Well (`double_well`):** $U(x) = 0.42(x^2 - x_0^2)^2 + 0.12x$.
- **5 Analytical Conservative Surrogates ($\hat{F}(x) = -\nabla \hat{U}(x)$):**
  `Harmonic Hooke`, `Quartic Taylor (p=4)` *(demonstrates catastrophic OOD $-\infty$ holes!)*, `Conservative RBF-GP (sGDML-style)` *(exact epistemic $\pm 2\sigma_F(x)$)*, `MACE-Style Radial–Bessel + Confining Prior`, and `4-Member Neural Feature Committee (Query-by-Committee)`.
- **4 Time Integrators & Thermostats:**
  `Velocity Verlet (Symplectic NVE)`, `Forward Euler (Non-Symplectic)`, `Classical RK4`, and `BAOAB Langevin Thermostat (NVT)`.
- **On-the-Fly Active Learning (`+ Add DFT Query x*`):**
  Click `+ Add DFT Query x*` to evaluate the exact reference potential at the highest-uncertainty OOD configuration $x^* = \arg\max \sigma_F(x)$ and heal surrogate extrapolation errors interactively.

### Independent MACE Metric Checker (`evidence/check_simulation.py`)

Two upstream NumPy error functions vendored from [MACE (`mace/tools/utils.py`)](https://github.com/ACEsuit/mace/blob/1f44a4b3e81c316ae9f03a646f21c66766d1ef01/mace/tools/utils.py) (see `evidence/vendor/mace/LICENSE`) independently refit harmonic stiffness and verify exported trajectory MAE/RMSE to $< 10^{-10}$ on the canonical Quartic + Harmonic + Velocity Verlet setup:

```sh
python evidence/check_simulation.py simulation-report.json
node studio/test-simulation.cjs
```

---

## Track B · Biomolecular Free-Energy Landscapes & 3D Ensemble Breathing (`BioEmu` & Enhanced Sampling)

Motivated by **[Microsoft BioEmu](https://github.com/microsoft/bioemu)** (*Lewis et al., 2025*) and enhanced-sampling statistical mechanics:

- **4 Conformational Free-Energy Benchmarks:**
  1. **Discrete Two-State Allosteric Switch (`two_state`)**
  2. **1D Continuous Cryptic-Pocket Double Well + Shoulder (`cryptic_1d`)**
  3. **2D Müller–Brown Canonical Three-Basin Potential Surface (`muller_brown`)**
  4. **2D Alanine Dipeptide $(\phi, \psi)$ Ramachandran Backbone Landscape (`ramachandran`)**
- **4 Sampling & Emulation Engines:**
  `Langevin BAOAB MD`, `Random-Walk Metropolis MCMC`, `Well-Tempered Metadynamics` *(adaptive Gaussian bias hills + exact umbrella reweighting)*, and `BioEmu Direct Equilibrium Emulator` *($\tau_{\text{int}} \approx 1.0$, barrier-invariant equilibrium draws)*.
- **Live 3D Structural Coupling (`Mol3D`):**
  Synchronizes sampled reaction coordinates $q(t)$ with localized 3D conformational gate/loop breathing on bundled structures (`PDB 1MBO` Oxymyoglobin Distal His64 Heme Gate, `PDB 1UBQ` Ubiquitin $\beta_1\text{–}\beta_2$ Pincer, and `AlphaFold P04637` TP53 DNA-Binding Loops).

---

## Classroom & Research Team Protocol (35 Minutes)

1. **Analyst (10 min):** Pre-register a quantitative prediction, compare In-Domain vs. OOD Force RMSE (or Langevin MD vs. BioEmu $\Delta G$ error & $N_{\text{eff}}$), and export `simulation-report.json` + `.md` audit.
2. **Peer Reviewer (10 min):** Verify canonical metrics with `python evidence/check_simulation.py` or audit multi-seed dispersion (`20-Seed Variance` tab) and symplectic energy drift (`Energy Drift ΔH(t)` tab).
3. **Team Lead (10 min):** Recommend one concrete action—adding active-learning DFT anchors $x^*$, switching to a symplectic/physics-informed potential, or applying Metadynamics/BioEmu across high $\Delta G^\ddagger$ barriers.
4. **Synthesis (5 min):** Swap roles and specify what new simulation observable ($S(\omega)$, $\tau_{\text{int}}$, or independent biological structure) would overturn the conclusion.
