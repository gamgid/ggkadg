"""Extract the supplied home-screen icon from a baseline JPEG using stdlib only."""
import math, struct, sys, zlib
from pathlib import Path

ZIGZAG=(0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63)
COS=[[math.cos((2*x+1)*u*math.pi/16) for x in range(8)] for u in range(8)]
C=[1/math.sqrt(2)]+[1.0]*7

class Bits:
    def __init__(self,data):
        clean=bytearray(); i=0
        while i<len(data):
            if data[i]==255 and i+1<len(data):
                if data[i+1]==0: clean.append(255); i+=2; continue
                if 208<=data[i+1]<=215: i+=2; continue
            clean.append(data[i]); i+=1
        self.data,self.bit=clean,0
    def get(self,count=1):
        value=0
        for _ in range(count):
            value=(value<<1)|((self.data[self.bit>>3]>>(7-(self.bit&7)))&1); self.bit+=1
        return value

def huffman(bits,table):
    code=0
    for length in range(1,17):
        code=(code<<1)|bits.get()
        value=table.get((length,code))
        if value is not None: return value
    raise ValueError('Invalid Huffman code')

def signed(bits,size):
    if size==0:return 0
    value=bits.get(size)
    return value if value>=(1<<(size-1)) else value-(1<<size)+1

def idct(coeff):
    output=[0]*64
    for y in range(8):
        for x in range(8):
            total=0.0
            for v in range(8):
                for u in range(8): total+=C[u]*C[v]*coeff[v*8+u]*COS[u][x]*COS[v][y]
            output[y*8+x]=max(0,min(255,round(total/4+128)))
    return output

def decode(path):
    raw=Path(path).read_bytes()
    if raw[:2]!=b'\xff\xd8':raise ValueError('Not a JPEG')
    quant={}; htables={}; components={}; scan=[]; width=height=None; pos=2; entropy=b'';restart_interval=0
    while pos<len(raw):
        while pos<len(raw) and raw[pos]!=255:pos+=1
        while pos<len(raw) and raw[pos]==255:pos+=1
        marker=raw[pos];pos+=1
        if marker==217:break
        if marker in range(208,216):continue
        length=struct.unpack('>H',raw[pos:pos+2])[0]; payload=raw[pos+2:pos+length]; pos+=length
        if marker==219:
            cursor=0
            while cursor<len(payload):
                info=payload[cursor];cursor+=1
                if info>>4:raise ValueError('16-bit quantization is unsupported')
                values=payload[cursor:cursor+64];cursor+=64;table=[0]*64
                for index,value in enumerate(values):table[ZIGZAG[index]]=value
                quant[info&15]=table
        elif marker==196:
            cursor=0
            while cursor<len(payload):
                info=payload[cursor];counts=payload[cursor+1:cursor+17];cursor+=17;table={};code=0
                for bit_length,count in enumerate(counts,1):
                    for _ in range(count):table[(bit_length,code)]=payload[cursor];cursor+=1;code+=1
                    code<<=1
                htables[(info>>4,info&15)]=table
        elif marker==192:
            height,width=struct.unpack('>HH',payload[1:5]);count=payload[5]
            for index in range(count):
                cid,sampling,qid=payload[6+index*3:9+index*3]
                components[cid]={'h':sampling>>4,'v':sampling&15,'q':qid,'dc':0}
        elif marker==221:
            restart_interval=struct.unpack('>H',payload)[0]
        elif marker==218:
            count=payload[0]
            for index in range(count):
                cid,tables=payload[1+index*2:3+index*2]
                components[cid]['dc_table']=tables>>4;components[cid]['ac_table']=tables&15;scan.append(cid)
            end=pos
            while end+1<len(raw) and not(raw[end]==255 and raw[end+1]==217):end+=1
            entropy=raw[pos:end];break
        elif marker in (193,194):raise ValueError('Only baseline JPEG is supported')
    max_h=max(item['h'] for item in components.values());max_v=max(item['v'] for item in components.values())
    mcu_cols=(width+max_h*8-1)//(max_h*8);mcu_rows=(height+max_v*8-1)//(max_v*8);planes={}
    for cid,item in components.items():
        plane_width=mcu_cols*item['h']*8;plane_height=mcu_rows*item['v']*8;item['plane_width']=plane_width
        planes[cid]=[[0]*plane_width for _ in range(plane_height)]
    chunks=[];start=0;i=0
    while i+1<len(entropy):
        if entropy[i]==255 and 208<=entropy[i+1]<=215:
            chunks.append(entropy[start:i]);start=i+2;i+=2;continue
        i+=1
    chunks.append(entropy[start:]);chunk_index=0;bits=Bits(chunks[0]);mcu_index=0
    for my in range(mcu_rows):
        for mx in range(mcu_cols):
            if restart_interval and mcu_index and mcu_index%restart_interval==0:
                chunk_index+=1;bits=Bits(chunks[chunk_index])
                for item in components.values():item['dc']=0
            for cid in scan:
                item=components[cid]
                for by in range(item['v']):
                    for bx in range(item['h']):
                        coeff=[0]*64;size=huffman(bits,htables[(0,item['dc_table'])]);item['dc']+=signed(bits,size)
                        coeff[0]=item['dc']*quant[item['q']][0];k=1
                        while k<64:
                            symbol=huffman(bits,htables[(1,item['ac_table'])])
                            if symbol==0:break
                            run,size=symbol>>4,symbol&15
                            if symbol==240:k+=16;continue
                            k+=run
                            if k>=64:break
                            natural=ZIGZAG[k];coeff[natural]=signed(bits,size)*quant[item['q']][natural];k+=1
                        block=idct(coeff);x0=(mx*item['h']+bx)*8;y0=(my*item['v']+by)*8
                        for row in range(8):planes[cid][y0+row][x0:x0+8]=block[row*8:row*8+8]
            mcu_index+=1
    ids=list(components);rgb=[]
    for y in range(height):
        row=bytearray()
        for x in range(width):
            samples=[]
            for cid in ids:
                item=components[cid];samples.append(planes[cid][y*item['v']//max_v][x*item['h']//max_h])
            if len(samples)==1:red=green=blue=samples[0]
            else:
                yy,cb,cr=samples[:3];red=yy+1.402*(cr-128);green=yy-.344136*(cb-128)-.714136*(cr-128);blue=yy+1.772*(cb-128)
            row.extend(max(0,min(255,round(value))) for value in (red,green,blue))
        rgb.append(bytes(row))
    return width,height,rgb

def resize_crop(rows,crop,size):
    left,top,right,bottom=crop;source_size=right-left
    source=[bytearray(rows[y][left*3:right*3]) for y in range(top,bottom)]
    # The JPEG is a home-screen photo. Remove only the wallpaper connected to
    # the crop border; iOS/Android will apply their own icon mask afterwards.
    sample=[]
    for y in range(22,38):sample.extend(source[y][80*3:113*3])
    cream=tuple(round(sum(sample[channel::3])/len(sample[channel::3])) for channel in range(3))
    queue=[];seen=set()
    for x in range(source_size):queue.extend(((x,0),(x,source_size-1)))
    for y in range(source_size):queue.extend(((0,y),(source_size-1,y)))
    while queue:
        x,y=queue.pop()
        if (x,y) in seen:continue
        seen.add((x,y));pixel=source[y][x*3:x*3+3]
        if sum(pixel)/3>=215:continue
        source[y][x*3:x*3+3]=bytes(cream)
        for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0<=nx<source_size and 0<=ny<source_size:queue.append((nx,ny))
    output=[]
    for y in range(size):
        fy=(y+.5)*source_size/size-.5;y0=max(0,min(source_size-1,int(fy)));y1=min(source_size-1,y0+1);wy=max(0,fy-y0);row=bytearray()
        for x in range(size):
            fx=(x+.5)*source_size/size-.5;x0=max(0,min(source_size-1,int(fx)));x1=min(source_size-1,x0+1);wx=max(0,fx-x0)
            for channel in range(3):
                top_value=source[y0][x0*3+channel]*(1-wx)+source[y0][x1*3+channel]*wx
                bottom_value=source[y1][x0*3+channel]*(1-wx)+source[y1][x1*3+channel]*wx
                row.append(round(top_value*(1-wy)+bottom_value*wy))
        output.append(bytes(row))
    return output

def png(path,size,rows):
    def chunk(kind,payload):return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
    header=struct.pack('>IIBBBBB',size,size,8,2,0,0,0);pixels=zlib.compress(b''.join(b'\0'+row for row in rows),9)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',pixels)+chunk(b'IEND',b''))

source,output_dir=sys.argv[1:3];width,height,pixels=decode(source)
if (width,height)!=(282,296):raise ValueError(f'Unexpected reference size: {width}x{height}')
# Exact app tile in IMG_1773; the caption below it is intentionally excluded.
crop=(40,11,233,204)
for name,size in {'apple-touch-icon-v3.png':180,'pwa-icon-192-v3.png':192,'pwa-icon-512-v3.png':512}.items():
    png(Path(output_dir)/name,size,resize_crop(pixels,crop,size));print(f'Created {name} ({size}x{size})')
