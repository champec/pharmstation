::Last updated 26th November-2014 PaulDonohoe
::Original work developed by NHS Connecting for Health, copyright The Health and Social Care Information Centre

rmdir /q /s dmdDataLoader
rmdir /q /s C:\dmdDataLoader

::Get top level directory name
for /f "delims=\" %%a in ("%cd%") do echo %%~nxa > download_version.txt

set /p version=< download_version.txt 

set "version2=%version:~0,-1%"

set "src=C:\%version2%\dmdDataLoader"
set "dest=C:\dmdDataLoader"

Del /s /Q C:\%version2%\Extract_Folder\*
Del /s /Q C:\dmd_extract_tool\f_gtin2.xml


7za.exe e -oC:\%version2%\Extract_Folder C:\%version2%\XMLToUnzipInHere\*.zip
7za.exe e -oc:\%version2%\Extract_Folder C:\%version2%\Extract_Folder\*GTIN.zip
7za.exe e -oC:\%version2%\Extract_Folder C:\%version2%\Extract_Folder\*BNF.zip

::Del /Q \%version2%\XMLToUnzipInHere\*.zip

copy  C:\%version2%\Extract_Folder\*.xml C:\%version2%\xml

7za.exe x -oC:\%version2%\ C:\%version2%\dmdDataLoader.zip 

:: Copy xml files to xml directory
copy  xml\*.xml dmdDataLoader\xml\

:: Copy xsd files to xsd directory
copy  xsd\*.xsd dmdDataLoader\xsd\

:: Copy xsl files to xsl directory
copy  xsl\*.xsl dmdDataLoader\xsl\

ROBOCOPY C:\%version2%\dmdDataLoader C:\dmdDataLoader /MIR /MOVE


::Copy dir of files to find fdate
dir /b C:\dmdDataLoader\xml\*.xml > xml_files.txt 

::Get file name
set /p text=< xml_files.txt  
::echo %text%

::Get date
SET fdate=%text:~-10,6%
move C:\%version2%\Extract_Folder\f_gtin2_0%fdate%.xml C:\dmd_extract_tool\f_gtin2.xml
Del /s /Q xml\*.xml

::Delete all the old csv files
Del /Q C:\dmdDataLoader\csv\*.*

::Delete all the old excel files
Del /Q C:\dmdDataLoader\excel\*.*

::Convert the GTIN to proper format
c:\dmdDataLoader\GTINChanger\new-convert.exe


::XML TO CSV
::Converts the dm+d xml files to csv files 

::GTIN
if exist "C:\dmd_extract_tool\f_gtin2-EDITED.xml" (
	C:\dmdDataLoader\msxsl.exe C:\dmd_extract_tool\f_gtin2-EDITED.xml C:\dmdDataLoader\xsl\f_gtin.xsl -o C:\dmdDataLoader\csv\f_gtin.csv
	del c:\dmd_extract_tool\f_gtin2-EDITED.xml /F /Q
)
::BNF
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_bnf1_0%fdate%.xml C:\dmdDataLoader\xsl\f_bnf_Amp.xsl -o C:\dmdDataLoader\csv\f_bnf_Amp.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_bnf1_0%fdate%.xml C:\dmdDataLoader\xsl\f_bnf_Vmp.xsl -o C:\dmdDataLoader\csv\f_bnf_Vmp.csv

::AMP
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_amp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_amp_AmpType.xsl -o C:\dmdDataLoader\csv\f_amp_AmpType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_amp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_amp_ApiType.xsl -o C:\dmdDataLoader\csv\f_amp_ApiType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_amp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_amp_LicRouteType.xsl -o C:\dmdDataLoader\csv\f_amp_LicRouteType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_amp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_amp_AppProdInfoType.xsl -o C:\dmdDataLoader\csv\f_amp_AppProdInfoType.csv

::AMPP
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_ampp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_ampp_AmppType.xsl -o C:\dmdDataLoader\csv\f_ampp_AmppType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_ampp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_ampp_PackInfoType.xsl -o C:\dmdDataLoader\csv\f_ampp_PackInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_ampp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_ampp_ContentType.xsl -o C:\dmdDataLoader\csv\f_ampp_ContentType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_ampp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_ampp_PrescInfoType.xsl -o C:\dmdDataLoader\csv\f_ampp_PrescInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_ampp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_ampp_PriceInfoType.xsl -o C:\dmdDataLoader\csv\f_ampp_PriceInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_ampp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_ampp_ReimbInfoType.xsl -o C:\dmdDataLoader\csv\f_ampp_ReimbInfoType.csv

::VTM
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vtm2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vtm.xsl -o C:\dmdDataLoader\csv\f_vtm.csv

::INGREDIENT
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_ingredient2_3%fdate%.xml C:\dmdDataLoader\xsl\f_ingredient.xsl -o C:\dmdDataLoader\csv\f_ingredient.csv

::LOOKUP
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_CombPackIndInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_CombPackIndInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_CombProdIndInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_CombProdIndInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_BasisOfNameInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_BasisOfNameInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_NamechangeReasonInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_NamechangeReasonInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_VirProdPresStatInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_VirProdPresStatInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_ControlDrugCatInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_ControlDrugCatInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_LicAuthInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_LicAuthIndInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_UoMHistoryInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_UoMHistoryInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_FormHistoryInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_FormHistoryInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_OntFormRouteInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_OntFormRouteInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_RouteHistoryInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_RouteHistoryInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_DtPayCatInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_DtPayCatInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_SupplierSupplierInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_SupplierSupplierInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_FlavourInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_FlavourInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_ColourInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_ColourInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_BasisOfStrengthInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_BasisOfStrengthInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_ReimbStatInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_ReimbStatInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_SpecContInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_SpecContInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_VirProdNoAvailInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_VirProdNoAvailInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_DiscIndInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_DiscIndInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_DfIndInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_DfIndInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_PriceBasisInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_PriceBasisInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_LegalCatInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_LegalCatInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_AvailRestrictInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_AvailRestrictInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_LicAuthChgRsnInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_LicAuthChgRsnInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_lookup2_3%fdate%.xml C:\dmdDataLoader\xsl\f_lookup_DNDInfoType.xsl -o C:\dmdDataLoader\csv\f_lookup_DNDInfoType.csv

::VMP
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmp_VmpType.xsl -o C:\dmdDataLoader\csv\f_vmp_VmpType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmp_VpiType.xsl -o C:\dmdDataLoader\csv\f_vmp_VpiType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmp_OntDrugFormType.xsl -o C:\dmdDataLoader\csv\f_vmp_OntDrugFormType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmp_DrugFormType.xsl -o C:\dmdDataLoader\csv\f_vmp_DrugFormType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmp_DrugRouteType.xsl -o C:\dmdDataLoader\csv\f_vmp_DrugRouteType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmp_ControlInfoType.xsl -o C:\dmdDataLoader\csv\f_vmp_ControlInfoType.csv

::VMPP
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmpp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmpp_VmppType.xsl -o C:\dmdDataLoader\csv\f_vmpp_VmppType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmpp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmpp_DtInfoType.xsl -o C:\dmdDataLoader\csv\f_vmpp_DtInfoType.csv
C:\dmdDataLoader\msxsl.exe C:\dmdDataLoader\xml\f_vmpp2_3%fdate%.xml C:\dmdDataLoader\xsl\f_vmpp_ContentType.xsl -o C:\dmdDataLoader\csv\f_vmpp_ContentType.csv

::CSV to EXCEL
call C:\dmdDataLoader\csv-excel.xlsm