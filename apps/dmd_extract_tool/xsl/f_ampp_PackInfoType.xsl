<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<?ampp_PackInfoType?>
<xsl:template match="//PACK_INFO">
<xsl:value-of select="APPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="REIMB_STATCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="REIMB_STATDT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="REIMB_STATPREVCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PACK_ORDER_NO"/>
<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
