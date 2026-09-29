import numpy as np
from numba import njit

@njit(cache=True)
def simulate_groups(pnl,notion,fill,entered,h,fee):
    T=pnl.shape[0];P=20
    nav=np.ones((T,P));fees=np.zeros_like(nav);exposure=np.zeros_like(nav);counts=np.zeros((T,P),np.int32)
    capital=np.ones((h,P))/h;value=capital.copy();starts=np.full(h,-1,np.int32)
    active=np.zeros(P,np.int32)
    for d in range(1,T):
        for slot in range(h):
            s=starts[slot]
            if s<0:continue
            age=d-s-1
            for g in range(P):
                frac=fill[s,g];no=notion[s,age,g]
                budget=capital[slot,g]/(1+fee*frac)
                closing=fee*no if age==h else 0.
                value[slot,g]=budget*(1+pnl[s,age,g]-closing)
                fees[d,g]+=budget*closing
                if age<h:exposure[d,g]+=budget*no;counts[d,g]+=entered[s,g]
        s=d-1;slot=s%h;starts[slot]=s
        for g in range(P):
            capital[slot,g]=value[slot,g];frac=fill[s,g]
            budget=capital[slot,g]/(1+fee*frac);value[slot,g]=budget
            fees[d,g]+=fee*frac*budget;exposure[d,g]+=frac*budget;counts[d,g]+=entered[s,g]
            if entered[s,g]>0:active[g]+=1
            nav[d,g]=value[:,g].sum()
    return nav,fees,exposure,counts,active
