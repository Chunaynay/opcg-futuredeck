import cv2, numpy as np, sys, os, json
from PIL import Image, ImageOps
W,H=454,635; RATIO=63/88
def order(pts):
    s=pts.sum(1);d=np.diff(pts,axis=1).ravel()
    return np.array([pts[np.argmin(s)],pts[np.argmin(d)],pts[np.argmax(s)],pts[np.argmax(d)]],dtype=np.float32)  # tl,tr,br,bl
def find_card(img):
    best=None
    for fx in (0.45,0.55,0.62,0.68,0.72):
        q,r,a=find_card_at(img,fx)
        if best is None or abs(r-RATIO)<abs(best[1]-RATIO):best=(q,r,a)
        if abs(r-RATIO)<0.04:break
    return best
def find_card_at(img,fx):
    h,w=img.shape[:2];x0=int(w*fx)
    sub=img[:,x0:].astype(int)
    rowbg=img[:,w-3:w].astype(int).mean(1)[:,None,:]   # 每列的背景色（取最右邊）
    mask=(np.abs(sub-rowbg).max(2)>22).astype(np.uint8)*255
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((15,15),np.uint8))
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((31,31),np.uint8))
    cnts,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    c=max(cnts,key=cv2.contourArea)
    rect=cv2.minAreaRect(c);box=cv2.boxPoints(rect);box[:,0]+=x0
    q=order(box)
    wq=(np.linalg.norm(q[1]-q[0])+np.linalg.norm(q[2]-q[3]))/2;hq=(np.linalg.norm(q[3]-q[0])+np.linalg.norm(q[2]-q[1]))/2
    return q,wq/hq,rect[2]
def crop(src,dst):
    img=cv2.cvtColor(np.asarray(ImageOps.exif_transpose(Image.open(src)).convert('RGB')),cv2.COLOR_RGB2BGR)
    q,ratio,ang=find_card(img);note=''
    if abs(ratio-RATIO)>0.06:   # 不是乾淨的卡面（例如照片）：先取偵測到的矩形，再等比填滿裁切，請人工調整
        wq=int((np.linalg.norm(q[1]-q[0])+np.linalg.norm(q[2]-q[3]))/2);hq=int((np.linalg.norm(q[3]-q[0])+np.linalg.norm(q[2]-q[1]))/2)
        M=cv2.getPerspectiveTransform(q,np.float32([[0,0],[wq,0],[wq,hq],[0,hq]]));im=cv2.warpPerspective(img,M,(wq,hq),flags=cv2.INTER_AREA)
        sc=max(W/wq,H/hq);im=cv2.resize(im,(round(wq*sc),round(hq*sc)),interpolation=cv2.INTER_AREA)
        x=(im.shape[1]-W)//2;y=(im.shape[0]-H)//2;out=im[y:y+H,x:x+W];note='卡圖來源不是乾淨卡面（比例 %.2f），請用「調整卡圖」重裁'%ratio
    else:
        M=cv2.getPerspectiveTransform(q,np.float32([[0,0],[W,0],[W,H],[0,H]]))
        out=cv2.warpPerspective(img,M,(W,H),flags=cv2.INTER_AREA)
    cv2.imwrite(dst,out,[cv2.IMWRITE_JPEG_QUALITY,88])
    return dict(ratio=round(float(ratio),3),angle=round(float(ang),1),box=q.round().astype(int).tolist(),note=note)
if __name__=='__main__':
    os.makedirs('crop2',exist_ok=True);log={}
    for f in sys.argv[1:]:
        r=crop(f,'crop2/'+os.path.basename(f));log[os.path.basename(f)]=r;print(f,r['ratio'],r['angle'])
    json.dump(log,open('crop2/_log.json','w'),indent=1)
