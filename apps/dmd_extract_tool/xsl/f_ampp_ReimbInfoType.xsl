<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<?ampp_ReimbInfoType?>
<xsl:template match="//REIMB_INFO">
<xsl:value-of select="APPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PX_CHRGS"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="DISP_FEES"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="BB"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="LTD_STAB"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="CAL_PACK"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="SPEC_CONTCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="DND"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="FP34D"/>

<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
