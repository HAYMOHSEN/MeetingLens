#include "FrameProtocol.h"
#include <array>
#include <iostream>
#include <stdexcept>
#include <vector>
using namespace MeetingLens;
static int passed = 0;
static void Check(bool value, const char* label) { if (!value) throw std::runtime_error(label); ++passed; }
static void Put16(uint8_t* p, uint16_t v) { p[0]=uint8_t(v);p[1]=uint8_t(v>>8); }
static void Put32(uint8_t* p, uint32_t v) { for(int i=0;i<4;++i)p[i]=uint8_t(v>>(8*i)); }
static void Put64(uint8_t* p, uint64_t v) { for(int i=0;i<8;++i)p[i]=uint8_t(v>>(8*i)); }
int main() try
{
    std::array<uint8_t, HeaderBytes> bytes{};
    Put32(bytes.data(), Magic); Put16(bytes.data()+4,1); Put16(bytes.data()+6,40);
    Put32(bytes.data()+8,Width);Put32(bytes.data()+12,Height);Put32(bytes.data()+16,Stride);
    Put32(bytes.data()+20,PayloadBytes);Put64(bytes.data()+24,0xFEDCBA9876543210ULL);Put64(bytes.data()+32,12345);
    FrameHeader frame;
    Check(ParseHeader(bytes.data(),bytes.size(),frame),"valid transport header");
    Check(frame.sequence==0xFEDCBA9876543210ULL && frame.captureTickMs==12345,"64-bit little endian fields");
    Check(!ParseHeader(nullptr,40,frame),"null input");
    Check(!ParseHeader(bytes.data(),39,frame),"truncated header");
    Check(!ParseHeader(bytes.data(),41,frame),"unexpected header length");
    for (size_t offset : {size_t(0),size_t(4),size_t(6),size_t(8),size_t(12),size_t(16),size_t(20)})
    { auto bad=bytes;bad[offset]^=0x40;Check(!ParseHeader(bad.data(),bad.size(),frame),"invalid dimensions/version/length rejected"); }
    Check(IsFresh(1000,1000),"current capture fresh");Check(IsFresh(1000,1749),"749ms boundary fresh");
    Check(!IsFresh(1000,1750),"750ms boundary expired");
    Check(!IsFresh(1000,1751),"old frame expired");Check(!IsFresh(2000,1000),"future timestamp rejected");
    Check(IsValidPipeName((L"MeetingLens.Camera."+std::wstring(64,L'a')).c_str()),"256-bit session pipe accepted");
    Check(!IsValidPipeName((L"MeetingLens.Camera."+std::wstring(32,L'a')).c_str()),"short session key rejected");
    Check(!IsValidPipeName((L"MeetingLens.Camera."+std::wstring(63,L'a')+L"/").c_str()),"path injection rejected");
    Check(!IsValidPipeName((L"Other.Camera."+std::wstring(64,L'a')).c_str()),"foreign pipe rejected");
    Check(!IsValidPipeName(nullptr),"null pipe rejected");
    std::vector<uint8_t> rgb(16,0), nv12(6,0);
    Check(BgraToNv12(rgb.data(),rgb.size(),nv12.data(),nv12.size(),2,2,2),"black conversion");
    Check(nv12==std::vector<uint8_t>({16,16,16,16,128,128}),"limited-range black exact");
    for(auto& p:rgb)p=255;
    Check(BgraToNv12(rgb.data(),rgb.size(),nv12.data(),nv12.size(),2,2,2),"white conversion");
    Check(nv12==std::vector<uint8_t>({235,235,235,235,128,128}),"limited-range white exact");
    for(size_t i=0;i<4;++i){rgb[4*i]=0;rgb[4*i+1]=0;rgb[4*i+2]=255;rgb[4*i+3]=255;}
    Check(BgraToNv12(rgb.data(),rgb.size(),nv12.data(),nv12.size(),2,2,2),"red conversion");
    Check(nv12[0]==82 && nv12[4]==90 && nv12[5]==240,"BGRA channel order correct");
    // 2x2 red/blue checker: average chroma differs from sampling just the final row's first pixel.
    rgb={0,0,255,255,255,0,0,255,255,0,0,255,0,0,255,255};
    Check(BgraToNv12(rgb.data(),rgb.size(),nv12.data(),nv12.size(),2,2,2),"checker conversion");
    Check(nv12[0]==82 && nv12[1]==41 && nv12[4]==165 && nv12[5]==175,"all four pixels contribute chroma");
    Check(!BgraToNv12(rgb.data(),15,nv12.data(),6,2,2,2),"short source rejected");
    Check(!BgraToNv12(rgb.data(),16,nv12.data(),5,2,2,2),"short output rejected");
    Check(!BgraToNv12(rgb.data(),16,nv12.data(),6,1,2,2),"odd width rejected");
    Check(!BgraToNv12(rgb.data(),16,nv12.data(),6,2,2,1),"short stride rejected");
    std::vector<uint8_t> padded(12,0xEE);
    Check(BgraToNv12(rgb.data(),16,padded.data(),12,2,2,4),"padded output accepted");
    Check(padded[2]==0xEE && padded[3]==0xEE && padded[6]==0xEE && padded[10]==0xEE,"padding untouched");
    std::cout << "PASS " << passed << " frame protocol and color conversion checks\n";
    return 0;
}
catch(const std::exception& error){std::cerr<<"FAIL "<<error.what()<<'\n';return 1;}
